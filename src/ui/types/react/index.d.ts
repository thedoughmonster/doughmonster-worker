declare namespace React {
  type Key = string | number | null;

  interface Attributes {
    key?: Key;
  }

  interface ReactElement<P = any, T extends string | ComponentType<any> = any> {
    type: T;
    props: P;
    key: Key;
  }

  type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactNode[];

  interface FunctionComponent<P = {}> {
    (props: P & { children?: ReactNode }): ReactElement | null;
    displayName?: string;
    defaultProps?: Partial<P>;
  }

  type FC<P = {}> = FunctionComponent<P>;
  type ComponentType<P = {}> = FunctionComponent<P>;
  type ComponentProps<T> = T extends ComponentType<infer P> ? P : never;

  function memo<T extends ComponentType<any>>(
    component: T,
    propsAreEqual?: (
      prevProps: Readonly<ComponentProps<T>>,
      nextProps: Readonly<ComponentProps<T>>
    ) => boolean
  ): T;

  function useState<S>(
    initialState: S | (() => S)
  ): [S, (value: S | ((prevState: S) => S)) => void];

  function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

  function useCallback<T extends (...args: any[]) => any>(
    callback: T,
    deps: readonly unknown[]
  ): T;

  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;

  interface MutableRefObject<T> {
    current: T;
  }

  function useRef<T>(initialValue: T): MutableRefObject<T>;
}

declare const React: {
  memo: typeof React.memo;
  useState: typeof React.useState;
  useMemo: typeof React.useMemo;
  useCallback: typeof React.useCallback;
  useEffect: typeof React.useEffect;
  useRef: typeof React.useRef;
};

declare module "react" {
  export = React;
  export as namespace React;

  export type ReactNode = React.ReactNode;
  export type FC<P = {}> = React.FC<P>;
  export type FunctionComponent<P = {}> = React.FunctionComponent<P>;
  export type ComponentType<P = {}> = React.ComponentType<P>;

  export const memo: typeof React.memo;
  export const useState: typeof React.useState;
  export const useMemo: typeof React.useMemo;
  export const useCallback: typeof React.useCallback;
  export const useEffect: typeof React.useEffect;
  export const useRef: typeof React.useRef;
}

declare namespace JSX {
  interface Element extends React.ReactElement {}
  interface ElementClass {
    render: () => React.ReactElement | null;
  }
  interface ElementAttributesProperty {
    props: any;
  }
  interface IntrinsicAttributes extends React.Attributes {}
  interface IntrinsicClassAttributes<T> extends React.Attributes {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
