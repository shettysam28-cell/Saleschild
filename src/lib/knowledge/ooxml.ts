import { SaxesParser } from "saxes";
import { fail } from "./diagnostics";
const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const plain = new Set([
  main,
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://schemas.openxmlformats.org/package/2006/content-types",
]);
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Expanded XML names are canonicalized, so valid namespace aliases do not depend on a writer's chosen prefixes.
export function canonicalOOXML(xml: string) {
  const parser = new SaxesParser({ xmlns: true });
  let output = "";
  const stack: { name: string; defaultNS: string }[] = [];
  parser.on("doctype", () =>
    fail("UNSAFE_WORKBOOK", "XML document types and entities are not supported."),
  );
  parser.on("opentag", (tag) => {
    const name = plain.has(tag.uri) ? tag.local : tag.name;
    const attrs: Record<string, string> = {};
    let current = stack.at(-1)?.defaultNS ?? "";
    for (const attribute of Object.values(tag.attributes)) {
      if (
        attribute.uri === relationships ||
        attribute.uri === "http://purl.oclc.org/ooxml/officeDocument/relationships"
      ) {
        attrs["r:" + attribute.local] = attribute.value;
        attrs["xmlns:r"] = relationships;
      } else attrs[attribute.name] = attribute.value;
    }
    if (attrs.xmlns) current = attrs.xmlns;
    const uri = tag.uri === "http://purl.oclc.org/ooxml/spreadsheetml/main" ? main : tag.uri;
    if (plain.has(tag.uri) && current !== uri) {
      attrs.xmlns = uri;
      current = uri;
    }
    if (
      tag.local === "Relationship" &&
      attrs.Type?.startsWith("http://purl.oclc.org/ooxml/officeDocument/relationships/")
    )
      attrs.Type = attrs.Type.replace(
        "http://purl.oclc.org/ooxml/officeDocument/relationships",
        relationships,
      );
    output +=
      "<" +
      name +
      Object.entries(attrs)
        .map(([key, value]) => " " + key + '="' + escape(value) + '"')
        .join("") +
      ">";
    stack.push({ name, defaultNS: current });
  });
  parser.on("closetag", () => {
    output += "</" + stack.pop()!.name + ">";
  });
  parser.on("text", (text) => (output += escape(text)));
  parser.on("cdata", (text) => (output += escape(text)));
  parser.write(xml).close();
  return new TextEncoder().encode(output);
}
