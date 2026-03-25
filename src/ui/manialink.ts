type Scalar = string | number | boolean;

interface ElementNode {
  name: string;
  attributes?: Record<string, Scalar | undefined>;
  children?: Array<ElementNode | string>;
}

export function renderManialink(root: ElementNode): string {
  return `<?xml version="1.0" encoding="utf-8"?>${renderNode(root)}`;
}

export function manialink(
  id: string,
  children: ElementNode[],
  version = 3
): ElementNode {
  return {
    name: "manialink",
    attributes: {
      id,
      version
    },
    children
  };
}

export function frame(
  attributes: Record<string, Scalar | undefined>,
  children: ElementNode[]
): ElementNode {
  return {
    name: "frame",
    attributes,
    children
  };
}

export function quad(attributes: Record<string, Scalar | undefined>): ElementNode {
  return {
    name: "quad",
    attributes
  };
}

export function label(attributes: Record<string, Scalar | undefined>): ElementNode {
  return {
    name: "label",
    attributes
  };
}

export function entry(attributes: Record<string, Scalar | undefined>): ElementNode {
  return {
    name: "entry",
    attributes
  };
}

function renderNode(node: ElementNode | string): string {
  if (typeof node === "string") {
    return escapeXml(node);
  }

  const attributes = Object.entries(node.attributes ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");

  if (!node.children || node.children.length === 0) {
    return `<${node.name}${attributes}/>`;
  }

  const children = node.children.map((child) => renderNode(child)).join("");
  return `<${node.name}${attributes}>${children}</${node.name}>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
