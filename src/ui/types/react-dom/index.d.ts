declare module "react-dom" {
  export function render(node: React.ReactNode, container: Element | DocumentFragment): void;
  export function createPortal(node: React.ReactNode, container: Element | DocumentFragment): any;
}
