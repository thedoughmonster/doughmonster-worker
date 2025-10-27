#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const requireCjs = createRequire(import.meta.url);
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const moduleCache = new Map();

function loadTsModule(entryPath) {
  const resolvedPath = path.resolve(entryPath);
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const source = fs.readFileSync(resolvedPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      resolveJsonModule: true,
      allowJs: true,
    },
    fileName: resolvedPath,
  });

  const moduleExports = {};
  const moduleObj = { exports: moduleExports };
  moduleCache.set(resolvedPath, moduleObj.exports);

  const script = new vm.Script(transpiled.outputText, { filename: resolvedPath });
  const dirname = path.dirname(resolvedPath);

  const localRequire = (specifier) => {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      let candidate = specifier.startsWith("/")
        ? specifier
        : path.resolve(dirname, specifier);

      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        const indexTs = path.join(candidate, "index.ts");
        const indexJs = path.join(candidate, "index.js");
        if (fs.existsSync(indexTs)) {
          return loadTsModule(indexTs);
        }
        if (fs.existsSync(indexJs)) {
          return requireCjs(indexJs);
        }
      }

      if (candidate.endsWith(".js")) {
        const tsCandidate = candidate.replace(/\.js$/, ".ts");
        if (fs.existsSync(tsCandidate)) {
          candidate = tsCandidate;
        }
      }

      if (!candidate.endsWith(".ts") && fs.existsSync(`${candidate}.ts`)) {
        candidate = `${candidate}.ts`;
      }

      if (candidate.endsWith(".ts")) {
        return loadTsModule(candidate);
      }

      if (fs.existsSync(candidate)) {
        return requireCjs(candidate);
      }

      throw new Error(`Cannot resolve module "${specifier}" from ${resolvedPath}`);
    }

    return requireCjs(specifier);
  };

  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: localRequire,
    __dirname: dirname,
    __filename: resolvedPath,
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
  };

  script.runInNewContext(context);
  moduleCache.set(resolvedPath, moduleObj.exports);
  return moduleObj.exports;
}

const toastModule = loadTsModule(path.join(rootDir, "src/docs/toast-schema.ts"));
const endpointsModule = loadTsModule(path.join(rootDir, "src/docs/endpoints.ts"));

const toastSchemas = toastModule.toastSchemas;
if (!toastSchemas) {
  throw new Error("Failed to load toast schemas");
}

const apiDocs = endpointsModule.apiDocs;
if (!apiDocs) {
  throw new Error("Failed to load endpoint metadata");
}

const toastSchemaCache = new Map();

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function convertToastSchema(descriptor) {
  const required = new Set(descriptor.required ?? []);
  const properties = {};

  for (const [name, prop] of Object.entries(descriptor.properties ?? {})) {
    properties[name] = convertToastProperty(prop);
    if (prop.required) {
      required.add(name);
    }
  }

  const schema = {
    title: descriptor.title,
    description: descriptor.description,
    type: "object",
    properties,
  };

  if (required.size > 0) {
    schema.required = Array.from(required);
  }

  return schema;
}

function convertToastProperty(prop) {
  const schema = {};
  if (prop.description) {
    schema.description = prop.description;
  }
  if (prop.enum) {
    schema.enum = [...prop.enum];
  }
  if (prop.format) {
    schema.format = prop.format;
  }

  switch (prop.type) {
    case "array": {
      schema.type = "array";
      if (prop.items) {
        schema.items = convertToastProperty(prop.items);
      }
      break;
    }
    case "object": {
      schema.type = "object";
      const properties = {};
      const required = [];
      for (const [name, child] of Object.entries(prop.properties ?? {})) {
        properties[name] = convertToastProperty(child);
        if (child.required) {
          required.push(name);
        }
      }
      if (Object.keys(properties).length > 0) {
        schema.properties = properties;
      }
      if (required.length > 0) {
        schema.required = required;
      }
      break;
    }
    case "integer":
    case "number":
    case "string":
    case "boolean":
    case "null": {
      schema.type = prop.type;
      break;
    }
    default: {
      if (prop.type) {
        schema.type = prop.type;
      }
    }
  }

  return schema;
}

function getToastSchema(key) {
  if (!toastSchemaCache.has(key)) {
    const descriptor = toastSchemas[key];
    if (!descriptor) {
      throw new Error(`Unknown Toast schema key: ${key}`);
    }
    toastSchemaCache.set(key, convertToastSchema(descriptor));
  }
  return deepClone(toastSchemaCache.get(key));
}

function convertSchemaNode(node) {
  switch (node.kind) {
    case "json":
      return convertJsonSchema(node);
    case "toast": {
      const schema = getToastSchema(node.schema);
      if (node.description) {
        schema.description = node.description;
      }
      if (node.deprecated !== undefined) {
        schema.deprecated = node.deprecated;
      }
      if (node.example !== undefined) {
        schema.example = node.example;
      }
      return schema;
    }
    case "ref": {
      const schema = { $ref: `#/components/schemas/${node.ref}` };
      if (node.description) {
        schema.description = node.description;
      }
      if (node.deprecated !== undefined) {
        schema.deprecated = node.deprecated;
      }
      if (node.example !== undefined) {
        schema.example = node.example;
      }
      return schema;
    }
    case "oneOf": {
      const converted = node.oneOf.map(convertSchemaNode);
      if (node.nullable && !converted.some(isNullSchema)) {
        converted.push({ type: "null" });
      }
      const schema = { oneOf: converted };
      if (node.description) {
        schema.description = node.description;
      }
      if (node.default !== undefined) {
        schema.default = node.default;
      }
      if (node.example !== undefined) {
        schema.example = node.example;
      }
      if (node.deprecated !== undefined) {
        schema.deprecated = node.deprecated;
      }
      return schema;
    }
    default:
      throw new Error(`Unsupported schema node kind: ${(node ?? {}).kind}`);
  }
}

function convertJsonSchema(node) {
  const schema = {};
  if (node.description) schema.description = node.description;
  if (node.type !== undefined) schema.type = node.type;
  if (node.enum) schema.enum = [...node.enum];
  if (node.const !== undefined) schema.const = node.const;
  if (node.format) schema.format = node.format;
  if (node.minimum !== undefined) schema.minimum = node.minimum;
  if (node.maximum !== undefined) schema.maximum = node.maximum;
  if (node.minItems !== undefined) schema.minItems = node.minItems;
  if (node.maxItems !== undefined) schema.maxItems = node.maxItems;
  if (node.pattern !== undefined) schema.pattern = node.pattern;
  if (node.default !== undefined) schema.default = node.default;
  if (node.example !== undefined) schema.example = node.example;
  if (node.deprecated !== undefined) schema.deprecated = node.deprecated;

  if (node.properties) {
    const properties = {};
    for (const [name, child] of Object.entries(node.properties)) {
      properties[name] = convertSchemaNode(child);
    }
    schema.properties = properties;
  }

  if (node.required) {
    schema.required = [...node.required];
  }

  if (node.items) {
    schema.items = convertSchemaNode(node.items);
  }

  if (node.additionalProperties !== undefined) {
    if (typeof node.additionalProperties === "boolean") {
      schema.additionalProperties = node.additionalProperties;
    } else {
      schema.additionalProperties = convertSchemaNode(node.additionalProperties);
    }
  }

  if (node.allOf) {
    schema.allOf = node.allOf.map(convertSchemaNode);
  }
  if (node.oneOf) {
    const converted = node.oneOf.map(convertSchemaNode);
    if (node.nullable && !converted.some(isNullSchema)) {
      converted.push({ type: "null" });
    }
    schema.oneOf = converted;
  }
  if (node.anyOf) {
    schema.anyOf = node.anyOf.map(convertSchemaNode);
  }

  applyNullable(schema, node.nullable);
  return schema;
}

function isNullSchema(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  if (candidate.type === "null") {
    return true;
  }
  if (Array.isArray(candidate.type)) {
    return candidate.type.includes("null");
  }
  return false;
}

function applyNullable(schema, nullable) {
  if (!nullable) {
    return;
  }
  if (schema.type === undefined) {
    if (schema.oneOf) {
      if (!schema.oneOf.some(isNullSchema)) {
        schema.oneOf = [...schema.oneOf, { type: "null" }];
      }
      return;
    }
    schema.type = ["null"];
    return;
  }
  if (Array.isArray(schema.type)) {
    if (!schema.type.includes("null")) {
      schema.type = [...schema.type, "null"];
    }
    return;
  }
  if (typeof schema.type === "string" && schema.type !== "null") {
    schema.type = [schema.type, "null"];
  }
}

function convertParameter(def) {
  const parameter = {
    name: def.name,
    in: def.in,
    description: def.description,
    schema: convertSchemaNode(def.schema),
  };
  if (def.required) parameter.required = true;
  if (def.deprecated) parameter.deprecated = true;
  if (def.allowEmptyValue) parameter.allowEmptyValue = true;
  if (def.style) parameter.style = def.style;
  if (def.explode !== undefined) parameter.explode = def.explode;
  if (def.example !== undefined) parameter.example = def.example;
  return parameter;
}

function convertResponse(def) {
  const response = {
    description: def.description,
  };
  if (def.headers && Object.keys(def.headers).length > 0) {
    const headers = {};
    for (const [name, header] of Object.entries(def.headers)) {
      headers[name] = {
        schema: convertSchemaNode(header.schema),
      };
      if (header.description) {
        headers[name].description = header.description;
      }
    }
    response.headers = headers;
  }
  if (def.content && Object.keys(def.content).length > 0) {
    const content = {};
    for (const [mediaType, schemaNode] of Object.entries(def.content)) {
      content[mediaType] = { schema: convertSchemaNode(schemaNode) };
    }
    response.content = content;
  }
  return response;
}

const componentsSchemas = {};
for (const [name, schemaNode] of Object.entries(apiDocs.schemas)) {
  componentsSchemas[name] = convertSchemaNode(schemaNode);
}

const componentsParameters = {};
for (const [name, paramDef] of Object.entries(apiDocs.parameters)) {
  componentsParameters[name] = convertParameter(paramDef);
}

const paths = new Map();
const methodOrder = ["get", "put", "post", "delete", "patch", "options", "head"];

for (const endpoint of apiDocs.endpoints) {
  const pathItem = paths.get(endpoint.path) ?? {};
  const methodObject = {
    summary: endpoint.summary,
    description: endpoint.description,
    tags: endpoint.tags,
    responses: {},
  };
  if (endpoint.deprecated) methodObject.deprecated = true;
  if (endpoint.parameters && endpoint.parameters.length > 0) {
    methodObject.parameters = endpoint.parameters.map((param) => {
      if (typeof param === "string") {
        return { $ref: `#/components/parameters/${param}` };
      }
      return convertParameter(param);
    });
  }

  const sortedResponses = endpoint.responses
    .slice()
    .sort((a, b) => compareStatus(a.status, b.status));
  for (const response of sortedResponses) {
    const statusKey = typeof response.status === "number" ? String(response.status) : response.status;
    methodObject.responses[statusKey] = convertResponse(response);
  }

  pathItem[endpoint.method] = methodObject;
  paths.set(endpoint.path, pathItem);
}

function compareStatus(a, b) {
  const rank = (status) => {
    if (status === "default") return Number.POSITIVE_INFINITY;
    return Number(status);
  };
  return rank(a) - rank(b);
}

const sortedPaths = {};
for (const [pathKey, operations] of Array.from(paths.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
  const sortedOperations = {};
  for (const method of methodOrder) {
    if (operations[method]) {
      sortedOperations[method] = operations[method];
    }
  }
  for (const method of Object.keys(operations)) {
    if (!sortedOperations[method]) {
      sortedOperations[method] = operations[method];
    }
  }
  sortedPaths[pathKey] = sortedOperations;
}

const sortedSchemas = Object.fromEntries(
  Object.entries(componentsSchemas).sort((a, b) => a[0].localeCompare(b[0]))
);

const sortedParameters = Object.fromEntries(
  Object.entries(componentsParameters).sort((a, b) => a[0].localeCompare(b[0]))
);

const openapiDocument = {
  openapi: "3.1.0",
  info: apiDocs.info,
  servers: apiDocs.servers,
  tags: apiDocs.tags,
  paths: sortedPaths,
  components: {
    schemas: sortedSchemas,
    parameters: sortedParameters,
  },
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatKey(key) {
  return /^[A-Za-z0-9_\-\.\/]+$/.test(key) ? key : JSON.stringify(key);
}

function formatScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "string") {
    if (value === "") return '""';
    if (/^[A-Za-z0-9_\-\.\/]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}[]`;
    }
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad}- ${formatScalar(item)}`;
        }
        const nested = toYaml(item, indent + 2);
        return `${pad}-\n${nested}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${pad}{}`;
    }
    return entries
      .map(([key, val]) => {
        const keyStr = formatKey(key);
        if (isScalar(val)) {
          return `${pad}${keyStr}: ${formatScalar(val)}`;
        }
        const nested = toYaml(val, indent + 2);
        return `${pad}${keyStr}:\n${nested}`;
      })
      .join("\n");
  }
  return `${pad}${formatScalar(value)}`;
}

const outputDir = path.join(rootDir, "schemas");
fs.mkdirSync(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, "openapi.json");
const yamlPath = path.join(outputDir, "openapi.yaml");

fs.writeFileSync(jsonPath, `${JSON.stringify(openapiDocument, null, 2)}\n`);
fs.writeFileSync(yamlPath, `${toYaml(openapiDocument)}\n`);

console.log(`OpenAPI written to ${jsonPath} and ${yamlPath}`);
