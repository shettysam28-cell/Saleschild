import { ImageResponse } from "next/og";
export const alt = "Saleschild — Where Knowledge Grows Into Performance.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#090d16",
        color: "#f5f3ec",
        padding: 65,
        width: "100%",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", color: "#c8ff5f", fontSize: 30 }}>saleschild.</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 82,
          letterSpacing: -5,
          lineHeight: 1.04,
        }}
      >
        <span>Knowledge.</span>
        <span style={{ color: "#c8ff5f" }}>In motion.</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 22,
          color: "#a4adbb",
          borderTop: "1px solid #3c4552",
          paddingTop: 25,
        }}
      >
        Where Knowledge Grows Into Performance.
      </div>
    </div>,
    size,
  );
}
