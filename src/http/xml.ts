import type { DavResource } from "../storage/r2.js";
import type { DavPath } from "./path.js";
import { hrefForPath } from "./path.js";

const LIVE_PROPERTIES = [
  "creationdate",
  "displayname",
  "getcontentlength",
  "getcontenttype",
  "getetag",
  "getlastmodified",
  "resourcetype",
  "supportedlock",
  "lockdiscovery",
];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function requestedProperties(body: string): { names: string[]; namesOnly: boolean } {
  if (!body || /<(?:[A-Za-z_][\w.-]*:)?(?:allprop|propname)\b/i.test(body)) {
    return {
      names: [...LIVE_PROPERTIES],
      namesOnly: /<(?:[A-Za-z_][\w.-]*:)?propname\b/i.test(body),
    };
  }

  const prop = body.match(
    /<(?:[A-Za-z_][\w.-]*:)?prop\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?prop\s*>/i,
  );
  if (!prop) return { names: [...LIVE_PROPERTIES], namesOnly: false };

  const names = new Set<string>();
  for (const qname of directElementNames(prop[1])) names.add(qname.split(":").at(-1) || qname);
  return { names: [...names], namesOnly: false };
}

export interface XmlPropertyName {
  qname: string;
  localName: string;
  namespace: string;
}

function namespaceBindings(body: string): Map<string, string> {
  const bindings = new Map<string, string>([["", ""]]);
  const declaration = /\bxmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(["'])(.*?)\2/g;
  for (const match of body.matchAll(declaration)) {
    const value = match[3]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    bindings.set(match[1] || "", value);
  }
  return bindings;
}

function directElementNames(xml: string): string[] {
  const names: string[] = [];
  const tags = /<\s*(\/)?([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s[^<>]*?)?(\/)?\s*>/g;
  let depth = 0;

  for (const match of xml.matchAll(tags)) {
    const closing = Boolean(match[1]);
    const selfClosing = Boolean(match[3]);
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) names.push(match[2]);
    if (!selfClosing) depth += 1;
  }

  return names;
}

export function proppatchPropertyNames(body: string): XmlPropertyName[] {
  if (!/<(?:[A-Za-z_][\w.-]*:)?propertyupdate\b/i.test(body)) return [];
  const bindings = namespaceBindings(body);
  const names = new Map<string, XmlPropertyName>();
  const operations = /<(?:[A-Za-z_][\w.-]*:)?(?:set|remove)\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?(?:set|remove)\s*>/gi;

  for (const operation of body.matchAll(operations)) {
    const prop = operation[1].match(
      /<(?:[A-Za-z_][\w.-]*:)?prop\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?prop\s*>/i,
    );
    if (!prop) continue;

    for (const qname of directElementNames(prop[1])) {
      const [prefix, localName] = qname.includes(":") ? qname.split(":", 2) : ["", qname];
      const namespace = bindings.get(prefix) || "";
      names.set(`${namespace}\u0000${localName}`, { qname, localName, namespace });
    }
  }
  return [...names.values()];
}

function propertyTag(property: XmlPropertyName): string {
  if (property.namespace === "DAV:") return `<d:${property.localName}/>`;
  if (!property.namespace && property.qname.includes(":")) {
    return `<${property.localName}/>`;
  }
  if (property.namespace && property.qname.includes(":")) {
    const [prefix] = property.qname.split(":", 1);
    return `<${property.qname} xmlns:${prefix}="${escapeXml(property.namespace)}"/>`;
  }
  if (property.namespace) {
    return `<p:${property.localName} xmlns:p="${escapeXml(property.namespace)}"/>`;
  }
  return `<${property.localName}/>`;
}

export function proppatchRejectedDocument(
  origin: string,
  path: DavPath,
  properties: XmlPropertyName[],
): string {
  const href = escapeXml(hrefForPath(origin, path, path.collectionHint));
  const tags = properties.map(propertyTag).join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${tags}</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status><d:error><d:cannot-modify-protected-property/></d:error></d:propstat></d:response></d:multistatus>`;
}

function propertyValue(name: string, resource: DavResource, path: DavPath): string | null {
  switch (name.toLowerCase()) {
    case "creationdate":
      return `<d:creationdate>${resource.uploaded.toISOString()}</d:creationdate>`;
    case "displayname":
      return `<d:displayname>${escapeXml(path.segments.at(-1) || "/")}</d:displayname>`;
    case "getcontentlength":
      return `<d:getcontentlength>${resource.size}</d:getcontentlength>`;
    case "getcontenttype":
      return `<d:getcontenttype>${escapeXml(resource.contentType)}</d:getcontenttype>`;
    case "getetag":
      return `<d:getetag>${escapeXml(resource.etag)}</d:getetag>`;
    case "getlastmodified":
      return `<d:getlastmodified>${resource.uploaded.toUTCString()}</d:getlastmodified>`;
    case "resourcetype":
      return resource.collection
        ? "<d:resourcetype><d:collection/></d:resourcetype>"
        : "<d:resourcetype/>";
    case "supportedlock":
      return "<d:supportedlock/>";
    case "lockdiscovery":
      return "<d:lockdiscovery/>";
    default:
      return null;
  }
}

export interface PropfindEntry {
  path: DavPath;
  resource: DavResource;
}

export function propfindDocument(
  origin: string,
  entries: PropfindEntry[],
  names: string[],
  namesOnly: boolean,
): string {
  const responses = entries.map(({ path, resource }) => {
    const found: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const value = propertyValue(name, resource, path);
      if (value === null) {
        missing.push(`<d:${name}/>`);
      } else {
        found.push(namesOnly ? `<d:${name}/>` : value);
      }
    }

    const href = escapeXml(hrefForPath(origin, path, resource.collection));
    const foundStat = found.length
      ? `<d:propstat><d:prop>${found.join("")}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`
      : "";
    const missingStat = missing.length
      ? `<d:propstat><d:prop>${missing.join("")}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`
      : "";

    return `<d:response><d:href>${href}</d:href>${foundStat}${missingStat}</d:response>`;
  });

  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses.join("")}</d:multistatus>`;
}
