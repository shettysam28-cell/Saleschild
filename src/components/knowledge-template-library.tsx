import { templateLibrary } from "@/lib/knowledge/templates";
export function KnowledgeTemplateLibrary() {
  return (
    <div className="template-library">
      <p>
        Fictional examples only. Replace sample facts with your approved sources. Excel includes
        Instructions and Sample Data sheets. Blank CSV files contain headers.
      </p>
      {templateLibrary.map((t) => (
        <article className="template-tile" key={t.id}>
          <h3>{t.name}</h3>
          <p>{t.topic}</p>
          <div>
            {(["xlsx", "csv"] as const).map((format) => (
              <div key={format}>
                <strong>{format.toUpperCase()}</strong>
                {(["blank", "sample"] as const).map((variant) => (
                  <a
                    key={variant}
                    href={`/app/knowledge/templates?id=${t.id}&format=${format}&variant=${variant}`}
                    download
                    aria-label={`Download ${t.name} ${variant} ${format} template`}
                  >
                    {variant === "blank" ? "Blank" : "With examples"}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
