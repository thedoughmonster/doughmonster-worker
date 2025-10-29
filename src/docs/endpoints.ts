import { toastSchemas } from "./toast-schema.js";

export type SchemaNode =
  | JsonSchemaNode
  | ToastSchemaNode
  | SchemaRefNode
  | OneOfSchemaNode;

export interface BaseSchemaNode {
  description?: string;
  nullable?: boolean;
  deprecated?: boolean;
  default?: unknown;
  example?: unknown;
}

export interface JsonSchemaNode extends BaseSchemaNode {
  kind: "json";
  type?:
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null";
  enum?: Array<string | number | boolean | null>;
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean | SchemaNode;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  allOf?: SchemaNode[];
}

export interface ToastSchemaNode extends BaseSchemaNode {
  kind: "toast";
  schema: keyof typeof toastSchemas;
}

export interface SchemaRefNode extends BaseSchemaNode {
  kind: "ref";
  ref: string;
}

export interface OneOfSchemaNode extends BaseSchemaNode {
  kind: "oneOf";
  oneOf: SchemaNode[];
}

export interface ParameterDefinition {
  name: string;
  in: "query" | "header" | "path";
  description: string;
  schema: SchemaNode;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: "form" | "simple";
  explode?: boolean;
  example?: unknown;
}

export interface HeaderDefinition {
  description?: string;
  schema: SchemaNode;
}

export interface ResponseDefinition {
  status: number | "default";
  description: string;
  content?: Record<string, SchemaNode>;
  headers?: Record<string, HeaderDefinition>;
}

export interface EndpointDefinition {
  path: string;
  method: "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
  summary: string;
  description: string;
  tags: string[];
  parameters?: Array<string | ParameterDefinition>;
  responses: ResponseDefinition[];
  deprecated?: boolean;
}

export interface ApiDocsMetadata {
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description?: string }>;
  schemas: Record<string, SchemaNode>;
  parameters: Record<string, ParameterDefinition>;
  endpoints: EndpointDefinition[];
}

const NORMALIZED_ORDER_TYPES = [
  "TAKEOUT",
  "DELIVERY",
  "DINE_IN",
  "CURBSIDE",
  "DRIVE_THRU",
  "CATERING",
  "UNKNOWN",
] as const;

const FULFILLMENT_STATUSES = ["NEW", "HOLD", "SENT", "READY"] as const;

const CONFIG_SLICES = [
  "diningOptions",
  "orderTypes",
  "revenueCenters",
  "serviceAreas",
  "taxRates",
  "discounts",
] as const;

const schemaDefinitions: Record<string, SchemaNode> = {
  HealthResponse: {
    kind: "json",
    type: "object",
    required: ["ok"],
    properties: {
      ok: { kind: "json", type: "boolean", const: true },
    },
  },
  ErrorObject: {
    kind: "json",
    type: "object",
    required: ["message"],
    properties: {
      message: { kind: "json", type: "string" },
      code: {
        kind: "json",
        type: "string",
        description: "Machine readable error code when available.",
      },
    },
  },
  ErrorResponse: {
    kind: "json",
    type: "object",
    required: ["ok", "error"],
    additionalProperties: true,
    properties: {
      ok: { kind: "json", type: "boolean", const: false },
      error: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "ErrorObject" },
          { kind: "json", type: "string" },
        ],
      },
    },
  },
  ToastMenusDocument: {
    kind: "toast",
    schema: "menusDocument",
    description: toastSchemas.menusDocument.description,
  },
  ToastOrder: {
    kind: "toast",
    schema: "order",
    description: toastSchemas.order.description,
  },
  ToastCheck: {
    kind: "toast",
    schema: "check",
    description: toastSchemas.check.description,
  },
  ToastSelection: {
    kind: "toast",
    schema: "selection",
    description: toastSchemas.selection.description,
  },
  ToastMenuItem: {
    kind: "toast",
    schema: "menuItem",
    description: toastSchemas.menuItem.description,
  },
  ToastModifierGroup: {
    kind: "toast",
    schema: "modifierGroup",
    description: toastSchemas.modifierGroup.description,
  },
  ToastModifierOption: {
    kind: "toast",
    schema: "modifierOption",
    description: toastSchemas.modifierOption.description,
  },
  MenusSuccess: {
    kind: "json",
    type: "object",
    required: ["ok", "menu", "metadata", "cacheHit"],
    properties: {
      ok: { kind: "json", type: "boolean", const: true },
      menu: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "ToastMenusDocument" },
          { kind: "json", type: "null" },
        ],
      },
      metadata: {
        kind: "json",
        type: "object",
        required: ["lastUpdated"],
        properties: {
          lastUpdated: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      cacheHit: { kind: "json", type: "boolean" },
    },
  },
  MenusResponse: {
    kind: "oneOf",
    oneOf: [
      { kind: "ref", ref: "MenusSuccess" },
      { kind: "ref", ref: "ErrorResponse" },
    ],
  },
  OrdersLatestSource: {
    kind: "json",
    type: "object",
    required: ["id", "source"],
    properties: {
      id: { kind: "json", type: "string" },
      source: {
        kind: "json",
        type: "string",
        enum: ["cache", "api", "merged"],
      },
    },
  },
  OrderCursor: {
    kind: "json",
    type: "object",
    properties: {
      ts: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string", format: "date-time" },
          { kind: "json", type: "null" },
        ],
      },
      orderGuid: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      businessDate: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "integer" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  OrdersLatestDebug: {
    kind: "json",
    type: "object",
    additionalProperties: true,
    properties: {
      fetchWindow: {
        kind: "json",
        type: "object",
        required: ["start", "end"],
        properties: {
          start: { kind: "json", type: "string", format: "date-time" },
          end: { kind: "json", type: "string", format: "date-time" },
        },
      },
      cursorBefore: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "OrderCursor" },
          { kind: "json", type: "null" },
        ],
      },
      cursorAfter: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "OrderCursor" },
          { kind: "json", type: "null" },
        ],
      },
      pages: {
        kind: "json",
        type: "array",
        items: {
          kind: "json",
          type: "object",
          properties: {
            page: { kind: "json", type: "integer" },
            count: { kind: "json", type: "integer" },
            returned: { kind: "json", type: "integer" },
            nextPage: {
              kind: "oneOf",
              oneOf: [
                { kind: "json", type: "integer" },
                { kind: "json", type: "null" },
              ],
            },
          },
        },
      },
      totals: {
        kind: "json",
        type: "object",
        properties: {
          fetched: { kind: "json", type: "integer" },
          written: { kind: "json", type: "integer" },
          skipped: { kind: "json", type: "integer" },
          readyCandidates: { kind: "json", type: "integer" },
        },
      },
      kv: {
        kind: "json",
        type: "object",
        properties: {
          reads: { kind: "json", type: "integer" },
          writes: { kind: "json", type: "integer" },
          indexLoads: { kind: "json", type: "integer" },
          indexWrites: { kind: "json", type: "integer" },
          bytesRead: { kind: "json", type: "integer" },
          bytesWritten: { kind: "json", type: "integer" },
        },
      },
      api: {
        kind: "json",
        type: "object",
        properties: {
          requests: { kind: "json", type: "integer" },
          pages: {
            kind: "json",
            type: "array",
            items: {
              kind: "json",
              type: "object",
              properties: {
                page: { kind: "json", type: "integer" },
                returned: { kind: "json", type: "integer" },
                count: { kind: "json", type: "integer" },
                nextPage: {
                  kind: "oneOf",
                  oneOf: [
                    { kind: "json", type: "integer" },
                    { kind: "json", type: "null" },
                  ],
                },
              },
            },
          },
        },
      },
      cache: {
        kind: "json",
        type: "object",
        properties: {
          hits: { kind: "json", type: "integer" },
          misses: { kind: "json", type: "integer" },
          updated: { kind: "json", type: "integer" },
        },
      },
      cursor: {
        kind: "json",
        type: "object",
        properties: {
          before: {
            kind: "oneOf",
            oneOf: [
              { kind: "ref", ref: "OrderCursor" },
              { kind: "json", type: "null" },
            ],
          },
          after: {
            kind: "oneOf",
            oneOf: [
              { kind: "ref", ref: "OrderCursor" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      timing: {
        kind: "json",
        type: "object",
        properties: {
          toastFetchMs: { kind: "json", type: "number" },
          kvMs: { kind: "json", type: "number" },
          totalMs: { kind: "json", type: "number" },
        },
      },
      params: {
        kind: "json",
        type: "object",
        additionalProperties: true,
        properties: {
          limit: { kind: "json", type: "integer" },
          detail: { kind: "json", type: "string" },
          debug: { kind: "json", type: "boolean" },
          since: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string" },
              { kind: "json", type: "null" },
            ],
          },
          locationId: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string" },
              { kind: "json", type: "null" },
            ],
          },
          status: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string" },
              { kind: "json", type: "null" },
            ],
          },
          pageSize: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "integer" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      resultCount: { kind: "json", type: "integer" },
    },
  },
  OrdersLatestBase: {
    kind: "json",
    type: "object",
    required: [
      "ok",
      "route",
      "limit",
      "detail",
      "minutes",
      "window",
      "pageSize",
      "expandUsed",
      "count",
      "ids",
    ],
    properties: {
      ok: { kind: "json", type: "boolean", const: true },
      route: {
        kind: "json",
        type: "string",
        description: "Echoed route path.",
        example: "/api/orders",
      },
      limit: { kind: "json", type: "integer" },
      detail: {
        kind: "json",
        type: "string",
        enum: ["full", "ids"],
      },
      minutes: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "integer" },
          { kind: "json", type: "null" },
        ],
      },
      window: {
        kind: "json",
        type: "object",
        required: ["start", "end"],
        properties: {
          start: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
          end: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
          businessDate: { kind: "json", type: "string" },
          timeZone: { kind: "json", type: "string" },
        },
      },
      pageSize: { kind: "json", type: "integer" },
      expandUsed: {
        kind: "json",
        type: "array",
        items: { kind: "json", type: "string" },
      },
      count: { kind: "json", type: "integer" },
      ids: {
        kind: "json",
        type: "array",
        items: { kind: "json", type: "string" },
      },
      orders: {
        kind: "oneOf",
        oneOf: [
          {
            kind: "json",
            type: "array",
            items: { kind: "ref", ref: "ToastOrder" },
          },
          {
            kind: "json",
            type: "array",
            items: { kind: "json", type: "string" },
          },
        ],
      },
      data: {
        kind: "oneOf",
        oneOf: [
          {
            kind: "json",
            type: "array",
            items: { kind: "ref", ref: "ToastOrder" },
          },
          { kind: "json", type: "null" },
        ],
      },
      sources: {
        kind: "json",
        type: "array",
        items: { kind: "ref", ref: "OrdersLatestSource" },
      },
      debug: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "OrdersLatestDebug" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  OrdersLatestSuccessFull: {
    kind: "json",
    allOf: [
      { kind: "ref", ref: "OrdersLatestBase" },
      {
        kind: "json",
        type: "object",
        required: ["orders"],
        properties: {
          detail: { kind: "json", type: "string", enum: ["full"] },
          orders: {
            kind: "json",
            type: "array",
            items: { kind: "ref", ref: "ToastOrder" },
          },
          data: {
            kind: "json",
            type: "array",
            items: { kind: "ref", ref: "ToastOrder" },
          },
        },
      },
    ],
  },
  OrdersLatestSuccessIds: {
    kind: "json",
    allOf: [
      { kind: "ref", ref: "OrdersLatestBase" },
      {
        kind: "json",
        type: "object",
        required: ["orders"],
        properties: {
          detail: { kind: "json", type: "string", enum: ["ids"] },
          orders: {
            kind: "json",
            type: "array",
            items: { kind: "json", type: "string" },
          },
        },
      },
    ],
  },
  OrdersLatestError: {
    kind: "json",
    type: "object",
    required: ["ok", "route", "error"],
    additionalProperties: true,
    properties: {
      ok: { kind: "json", type: "boolean", const: false },
      route: {
        kind: "json",
        type: "string",
        example: "/api/orders",
      },
      error: { kind: "json", type: "string" },
    },
  },
  OrdersLatestResponse: {
    kind: "oneOf",
    oneOf: [
      { kind: "ref", ref: "OrdersLatestSuccessFull" },
      { kind: "ref", ref: "OrdersLatestSuccessIds" },
      { kind: "ref", ref: "OrdersLatestError" },
    ],
  },
  ExpandedOrderItemModifier: {
    kind: "json",
    type: "object",
    required: ["name", "priceCents", "quantity"],
    properties: {
      id: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      name: { kind: "json", type: "string" },
      groupName: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      priceCents: { kind: "json", type: "integer" },
      quantity: { kind: "json", type: "number" },
    },
  },
  ExpandedOrderItemMoney: {
    kind: "json",
    type: "object",
    properties: {
      baseItemPriceCents: { kind: "json", type: "integer" },
      modifierTotalCents: { kind: "json", type: "integer" },
      totalItemPriceCents: { kind: "json", type: "integer" },
    },
  },
  ExpandedOrderItem: {
    kind: "json",
    type: "object",
    required: ["lineItemId", "itemName", "quantity", "modifiers"],
    properties: {
      lineItemId: { kind: "json", type: "string" },
      menuItemId: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      itemName: { kind: "json", type: "string" },
      quantity: { kind: "json", type: "number" },
      fulfillmentStatus: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      modifiers: {
        kind: "json",
        type: "array",
        items: { kind: "ref", ref: "ExpandedOrderItemModifier" },
      },
      specialInstructions: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      money: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "ExpandedOrderItemMoney" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  ExpandedOrderTotals: {
    kind: "json",
    type: "object",
    required: [
      "baseItemsSubtotalCents",
      "modifiersSubtotalCents",
      "discountTotalCents",
      "serviceChargeCents",
      "tipCents",
      "grandTotalCents",
    ],
    properties: {
      baseItemsSubtotalCents: { kind: "json", type: "integer" },
      modifiersSubtotalCents: { kind: "json", type: "integer" },
      discountTotalCents: { kind: "json", type: "integer" },
      serviceChargeCents: { kind: "json", type: "integer" },
      tipCents: { kind: "json", type: "integer" },
      grandTotalCents: { kind: "json", type: "integer" },
    },
  },
  ExpandedOrderData: {
    kind: "json",
    type: "object",
    required: ["orderId", "orderTime", "orderType"],
    properties: {
      orderId: { kind: "json", type: "string" },
      location: {
        kind: "json",
        type: "object",
        properties: {
          locationId: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      orderTime: { kind: "json", type: "string", format: "date-time" },
      timeDue: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string", format: "date-time" },
          { kind: "json", type: "null" },
        ],
      },
      orderNumber: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      checkId: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      status: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      fulfillmentStatus: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      customerName: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      orderType: { kind: "json", type: "string" },
      orderTypeNormalized: {
        kind: "oneOf",
        oneOf: [
          {
            kind: "json",
            type: "string",
            enum: [...NORMALIZED_ORDER_TYPES],
          },
          { kind: "json", type: "null" },
        ],
      },
      diningOptionGuid: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      deliveryState: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      deliveryInfo: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "object", additionalProperties: true },
          { kind: "json", type: "null" },
        ],
      },
      curbsidePickupInfo: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "object", additionalProperties: true },
          { kind: "json", type: "null" },
        ],
      },
      table: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "object", additionalProperties: true },
          { kind: "json", type: "null" },
        ],
      },
      seats: {
        kind: "oneOf",
        oneOf: [
          {
            kind: "json",
            type: "array",
            items: { kind: "json", type: "integer" },
          },
          { kind: "json", type: "null" },
        ],
      },
      employee: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "object", additionalProperties: true },
          { kind: "json", type: "null" },
        ],
      },
      promisedDate: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string", format: "date-time" },
          { kind: "json", type: "null" },
        ],
      },
      estimatedFulfillmentDate: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string", format: "date-time" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  ExpandedOrder: {
    kind: "json",
    type: "object",
    required: ["orderData", "items", "totals"],
    properties: {
      orderData: { kind: "ref", ref: "ExpandedOrderData" },
      currency: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      items: {
        kind: "json",
        type: "array",
        items: { kind: "ref", ref: "ExpandedOrderItem" },
      },
      totals: { kind: "ref", ref: "ExpandedOrderTotals" },
    },
  },
  UpstreamTrace: {
    kind: "json",
    type: "object",
    additionalProperties: true,
    required: ["path", "url", "absoluteUrl"],
    properties: {
      path: {
        kind: "json",
        type: "string",
        enum: ["direct", "network"],
      },
      internalFallbackUsed: { kind: "json", type: "boolean" },
      url: { kind: "json", type: "string" },
      absoluteUrl: { kind: "json", type: "string" },
      status: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "integer" },
          { kind: "json", type: "null" },
        ],
      },
      ok: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "boolean" },
          { kind: "json", type: "null" },
        ],
      },
      bytes: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "integer" },
          { kind: "json", type: "null" },
        ],
      },
      snippet: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      cacheStatus: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string" },
          { kind: "json", type: "null" },
        ],
      },
      cacheHit: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "boolean" },
          { kind: "json", type: "null" },
        ],
      },
      updatedAt: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "string", format: "date-time" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  DiagnosticsCounters: {
    kind: "json",
    type: "object",
    additionalProperties: true,
    properties: {
      ordersSeen: { kind: "json", type: "integer" },
      checksSeen: { kind: "json", type: "integer" },
      itemsIncluded: { kind: "json", type: "integer" },
      dropped: {
        kind: "json",
        type: "object",
        properties: {
          ordersVoided: { kind: "json", type: "integer" },
          ordersTimeParse: { kind: "json", type: "integer" },
          selectionsVoided: { kind: "json", type: "integer" },
          selectionsFiltered: { kind: "json", type: "integer" },
        },
      },
      totals: {
        kind: "json",
        type: "object",
        properties: {
          baseItemsSubtotalCents: { kind: "json", type: "integer" },
          modifiersSubtotalCents: { kind: "json", type: "integer" },
          discountTotalCents: { kind: "json", type: "integer" },
          serviceChargeCents: { kind: "json", type: "integer" },
          tipCents: { kind: "json", type: "integer" },
          grandTotalCents: { kind: "json", type: "integer" },
        },
      },
    },
  },
  OrdersDetailedDebug: {
    kind: "json",
    type: "object",
    additionalProperties: true,
    properties: {
      requestId: { kind: "json", type: "string" },
      timingMs: { kind: "json", type: "integer" },
      ordersTrace: { kind: "ref", ref: "UpstreamTrace" },
      menuTrace: { kind: "ref", ref: "UpstreamTrace" },
      window: {
        kind: "json",
        type: "object",
        required: ["startIso", "endIso"],
        properties: {
          startIso: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
          endIso: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      limit: { kind: "json", type: "integer" },
      originSeen: { kind: "json", type: "string" },
      lastPage: { kind: "json", type: "integer" },
      timedOut: { kind: "json", type: "boolean" },
      diagnostics: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "DiagnosticsCounters" },
          { kind: "json", type: "null" },
        ],
      },
      lookbackWindowsTried: {
        kind: "json",
        type: "array",
        items: { kind: "json", type: "integer" },
      },
      ordersFetched: { kind: "json", type: "integer" },
      ordersUpstream: { kind: "ref", ref: "UpstreamTrace" },
      menuUpstream: { kind: "ref", ref: "UpstreamTrace" },
    },
  },
  OrdersDetailedSuccess: {
    kind: "json",
    type: "object",
    required: ["orders", "cacheInfo"],
    properties: {
      orders: {
        kind: "json",
        type: "array",
        items: { kind: "ref", ref: "ExpandedOrder" },
      },
      cacheInfo: {
        kind: "json",
        type: "object",
        required: ["menu", "menuUpdatedAt"],
        properties: {
          menu: {
            kind: "json",
            type: "string",
            description:
              "Cache status for the menu payload (for example `hit-fresh` or `miss-network`).",
          },
          menuUpdatedAt: {
            kind: "oneOf",
            oneOf: [
              { kind: "json", type: "string", format: "date-time" },
              { kind: "json", type: "null" },
            ],
          },
        },
      },
      debug: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "OrdersDetailedDebug" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  OrdersDetailedError: {
    kind: "json",
    type: "object",
    required: ["error"],
    additionalProperties: true,
    properties: {
      error: { kind: "ref", ref: "ErrorObject" },
      debug: {
        kind: "oneOf",
        oneOf: [
          { kind: "ref", ref: "OrdersDetailedDebug" },
          { kind: "json", type: "null" },
        ],
      },
    },
  },
  OrdersDetailedResponse: {
    kind: "oneOf",
    oneOf: [
      { kind: "ref", ref: "OrdersDetailedSuccess" },
      { kind: "ref", ref: "OrdersDetailedError" },
      { kind: "ref", ref: "ErrorResponse" },
    ],
  },
  UpstreamSummary: {
    kind: "json",
    type: "object",
    required: ["path", "ok", "status", "body"],
    properties: {
      path: {
        kind: "json",
        type: "string",
        enum: ["direct", "network"],
      },
      ok: { kind: "json", type: "boolean" },
      status: {
        kind: "oneOf",
        oneOf: [
          { kind: "json", type: "integer" },
          { kind: "json", type: "null" },
        ],
      },
      body: {
        kind: "oneOf",
        nullable: true,
        oneOf: [
          { kind: "json", type: "object", additionalProperties: true },
          {
            kind: "json",
            type: "array",
            items: { kind: "json" },
          },
          { kind: "json", type: "string" },
          { kind: "json", type: "number" },
          { kind: "json", type: "boolean" },
          { kind: "json", type: "null" },
        ],
        description: "Parsed upstream body when available.",
      },
      errorMessage: { kind: "json", type: "string" },
    },
  },
  ConfigSnapshotResponse: {
    kind: "json",
    type: "object",
    required: ["updatedAt", "ttlSeconds", "data"],
    additionalProperties: false,
    properties: {
      updatedAt: { kind: "json", type: "string", format: "date-time" },
      ttlSeconds: { kind: "json", type: "integer" },
      data: {
        kind: "json",
        type: "object",
        required: [...CONFIG_SLICES],
        properties: CONFIG_SLICES.reduce<Record<string, SchemaNode>>((acc, slice) => {
          acc[slice] = {
            kind: "oneOf",
            nullable: true,
            description: `Toast ${slice} slice payload when available.`,
            oneOf: [
              { kind: "json", type: "object", additionalProperties: true },
              {
                kind: "json",
                type: "array",
                items: { kind: "json" },
              },
              { kind: "json", type: "string" },
              { kind: "json", type: "number" },
              { kind: "json", type: "boolean" },
              { kind: "json", type: "null" },
            ],
          };
          return acc;
        }, {}),
      },
    },
  },
  OpenApiDocument: {
    kind: "json",
    type: "object",
    description:
      "OpenAPI document describing the Doughmonster Worker HTTP interface.",
    additionalProperties: true,
  },
};

const parameterDefinitions: Record<string, ParameterDefinition> = {
  OrdersLatestLimit: {
    name: "limit",
    in: "query",
    description: "Maximum number of orders to return (defaults to 5).",
    schema: {
      kind: "json",
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 5,
    },
  },
  OrdersLatestDetail: {
    name: "detail",
    in: "query",
    description:
      "Toggle payload verbosity (`full` returns hydrated orders, `ids` returns GUIDs only).",
    schema: {
      kind: "json",
      type: "string",
      enum: ["full", "ids"],
      default: "full",
    },
  },
  OrdersLatestMinutes: {
    name: "minutes",
    in: "query",
    description: "Override the rolling window with an explicit lookback in minutes.",
    schema: {
      kind: "json",
      type: "integer",
      minimum: 1,
    },
  },
  OrdersLatestPageSize: {
    name: "pageSize",
    in: "query",
    description: "Hint for the Toast bulk API page size (advanced diagnostics only).",
    schema: {
      kind: "json",
      type: "integer",
      minimum: 1,
      maximum: 100,
    },
  },
  OrdersLatestStart: {
    name: "start",
    in: "query",
    description:
      "ISO-8601 timestamp that constrains the lower bound of the fetch window.",
    schema: { kind: "json", type: "string", format: "date-time" },
  },
  OrdersLatestEnd: {
    name: "end",
    in: "query",
    description:
      "ISO-8601 timestamp that constrains the upper bound of the fetch window.",
    schema: { kind: "json", type: "string", format: "date-time" },
  },
  OrdersLatestSince: {
    name: "since",
    in: "query",
    description: "Override the internal cursor with an ISO-8601 timestamp (debugging aid).",
    schema: { kind: "json", type: "string", format: "date-time" },
  },
  OrdersLatestBusinessDate: {
    name: "businessDate",
    in: "query",
    description: "Explicit Toast business date (yyyyMMdd) to anchor the fetch window.",
    schema: {
      kind: "json",
      type: "string",
      pattern: "^\\d{8}$",
    },
  },
  OrdersLatestTimeZone: {
    name: "timeZone",
    in: "query",
    description: "IANA time zone identifier used to interpret time-based parameters (defaults to UTC).",
    schema: {
      kind: "json",
      type: "string",
      default: "UTC",
    },
  },
  OrdersLatestDebug: {
    name: "debug",
    in: "query",
    description:
      "Include extended diagnostics when `true` and the worker runs with `DEBUG` enabled.",
    schema: { kind: "json", type: "boolean" },
  },
  OrdersDetailedLimit: {
    name: "limit",
    in: "query",
    description: "Maximum number of expanded orders to return (defaults to 5, maximum 500).",
    schema: {
      kind: "json",
      type: "integer",
      minimum: 1,
      maximum: 500,
      default: 5,
    },
  },
  OrdersDetailedStart: {
    name: "start",
    in: "query",
    description: "ISO-8601 timestamp for the earliest order to include.",
    schema: { kind: "json", type: "string", format: "date-time" },
  },
  OrdersDetailedEnd: {
    name: "end",
    in: "query",
    description: "ISO-8601 timestamp for the latest order to include.",
    schema: { kind: "json", type: "string", format: "date-time" },
  },
  OrdersDetailedMinutes: {
    name: "minutes",
    in: "query",
    description:
      "Look back this many minutes from \"now\" when no explicit window is provided.",
    schema: {
      kind: "json",
      type: "integer",
      minimum: 1,
    },
  },
  OrdersDetailedStatus: {
    name: "status",
    in: "query",
    description: "Filter orders by Toast status (case insensitive).",
    schema: { kind: "json", type: "string" },
  },
  OrdersDetailedFulfillmentStatus: {
    name: "fulfillmentStatus",
    in: "query",
    description:
      "Filter by normalized item fulfillment statuses. May be repeated or comma separated.",
    style: "form",
    explode: true,
    schema: {
      kind: "json",
      type: "array",
      items: {
        kind: "json",
        type: "string",
        enum: [...FULFILLMENT_STATUSES],
      },
    },
  },
  OrdersDetailedLocationId: {
    name: "locationId",
    in: "query",
    description: "Restrict results to the specified Toast location GUID.",
    schema: { kind: "json", type: "string" },
  },
  OrdersDetailedRefresh: {
    name: "refresh",
    in: "query",
    description: "Forwarded to `/api/menus` to force a synchronous refresh when set to `1`.",
    schema: { kind: "json", type: "boolean" },
  },
  OrdersDetailedDebug: {
    name: "debug",
    in: "query",
    description: "Include detailed diagnostics when enabled and the worker permits debug output.",
    schema: { kind: "json", type: "boolean" },
  },
  MenusRefresh: {
    name: "refresh",
    in: "query",
    description:
      "Force a synchronous refresh of the published menu when set to a truthy value.",
    schema: { kind: "json", type: "boolean" },
  },
};

const endpoints: EndpointDefinition[] = [
  {
    path: "/api/health",
    method: "get",
    summary: "Health check",
    description: "Returns `{\"ok\": true}` when the worker is healthy.",
    tags: ["Health"],
    responses: [
      {
        status: 200,
        description: "Worker is available.",
        content: {
          "application/json": { kind: "ref", ref: "HealthResponse" },
        },
      },
    ],
  },
  {
    path: "/api/docs/openapi.json",
    method: "get",
    summary: "Fetch the OpenAPI definition",
    description:
      "Returns the OpenAPI schema for the Doughmonster Worker API, suitable for AI agents and client code generation.",
    tags: ["Documentation"],
    responses: [
      {
        status: 200,
        description: "OpenAPI schema returned successfully.",
        headers: {
          "Cache-Control": {
            description:
              "Hints that the schema can be cached by clients for five minutes while allowing stale reuse for a day.",
            schema: { kind: "json", type: "string" },
          },
        },
        content: {
          "application/json": { kind: "ref", ref: "OpenApiDocument" },
        },
      },
    ],
  },
  {
    path: "/api/docs/openapi.js",
    method: "get",
    summary: "Fetch the OpenAPI definition as an ES module",
    description:
      "Returns the OpenAPI schema wrapped in a JavaScript module `export default` statement, useful for importing directly into documentation tooling.",
    tags: ["Documentation"],
    responses: [
      {
        status: 200,
        description: "OpenAPI schema module returned successfully.",
        headers: {
          "Cache-Control": {
            description:
              "Hints that the schema can be cached by clients for five minutes while allowing stale reuse for a day.",
            schema: { kind: "json", type: "string" },
          },
        },
        content: {
          "application/javascript": {
            kind: "json",
            type: "string",
            description: "JavaScript module source code exporting the OpenAPI document.",
          },
        },
      },
    ],
  },
  {
    path: "/api/menus",
    method: "get",
    summary: "Retrieve the cached Toast menu document",
    description:
      "Returns the currently cached Toast menus document along with cache metadata. Append `?refresh=1` (or any other truthy value) to force a synchronous refresh before responding.",
    tags: ["Menus"],
    parameters: ["MenusRefresh"],
    responses: [
      {
        status: 200,
        description: "Menu document retrieved successfully.",
        content: {
          "application/json": { kind: "ref", ref: "MenusResponse" },
        },
      },
      {
        status: 502,
        description: "Upstream Toast API failure.",
        content: {
          "application/json": { kind: "ref", ref: "ErrorResponse" },
        },
      },
      {
        status: "default",
        description: "Unexpected error response.",
        content: {
          "application/json": { kind: "ref", ref: "ErrorResponse" },
        },
      },
    ],
  },
  {
    path: "/api/orders",
    method: "get",
    summary: "Fetch the most recent Toast orders",
    description:
      "Returns the most recent Toast orders using the worker's incremental KV-backed cache. By default the worker returns the five newest orders with full detail. Pass `detail=ids` to receive only the GUIDs while retaining ordering.",
    tags: ["Orders"],
    parameters: [
      "OrdersLatestLimit",
      "OrdersLatestDetail",
      "OrdersLatestMinutes",
      "OrdersLatestPageSize",
      "OrdersLatestStart",
      "OrdersLatestEnd",
      "OrdersLatestSince",
      "OrdersLatestBusinessDate",
      "OrdersLatestTimeZone",
      "OrdersLatestDebug",
    ],
    responses: [
      {
        status: 200,
        description: "Orders fetched successfully.",
        content: {
          "application/json": { kind: "ref", ref: "OrdersLatestResponse" },
        },
      },
      {
        status: "default",
        description:
          "Error response emitted when the worker cannot return orders successfully.",
        content: {
          "application/json": { kind: "ref", ref: "ErrorResponse" },
        },
      },
    ],
  },
  {
    path: "/api/items-expanded",
    method: "get",
    summary: "Fetch expanded orders enriched with menu metadata",
    description:
      "Builds expanded orders by combining the latest Toast orders with menu metadata. Supports the same filtering, debug, and refresh controls as the legacy `/api/orders-detailed` endpoint.",
    tags: ["Orders"],
    parameters: [
      "OrdersDetailedLimit",
      "OrdersDetailedStart",
      "OrdersDetailedEnd",
      "OrdersDetailedMinutes",
      "OrdersDetailedStatus",
      "OrdersDetailedFulfillmentStatus",
      "OrdersDetailedLocationId",
      "OrdersDetailedRefresh",
      "OrdersDetailedDebug",
    ],
    responses: [
      {
        status: 200,
        description: "Expanded orders returned successfully.",
        content: {
          "application/json": { kind: "ref", ref: "OrdersDetailedSuccess" },
        },
      },
      {
        status: 502,
        description: "One or more upstream dependencies failed.",
        content: {
          "application/json": { kind: "ref", ref: "OrdersDetailedError" },
        },
      },
      {
        status: "default",
        description: "Unexpected error response.",
        content: {
          "application/json": { kind: "ref", ref: "ErrorResponse" },
        },
      },
    ],
  },
  {
    path: "/api/config/snapshot",
    method: "get",
    summary: "Fetch Toast configuration snapshot",
    description:
      "Fetches a fixed set of Toast configuration slices and caches the merged payload for one hour.",
    tags: ["Configuration"],
    responses: [
      {
        status: 200,
        description: "Configuration snapshot returned successfully.",
        content: {
          "application/json": { kind: "ref", ref: "ConfigSnapshotResponse" },
        },
      },
      {
        status: "default",
        description: "Unexpected error response.",
        content: {
          "application/json": { kind: "ref", ref: "ErrorResponse" },
        },
      },
    ],
  },
];

export const apiDocs: ApiDocsMetadata = {
  info: {
    title: "Doughmonster Worker API",
    version: "1.0.0",
    description:
      "OpenAPI metadata describing the public endpoints exposed by the Doughmonster Worker.",
  },
  servers: [
    {
      url: "https://doughmonster-worker.thedoughmonster.workers.dev",
      description: "Production deployment",
    },
    {
      url: "http://127.0.0.1:8787",
      description: "Local development (wrangler dev)",
    },
  ],
  tags: [
    { name: "Documentation" },
    { name: "Health" },
    { name: "Menus" },
    { name: "Orders" },
    { name: "Configuration" },
  ],
  schemas: schemaDefinitions,
  parameters: parameterDefinitions,
  endpoints,
};
