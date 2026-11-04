async function send(name: string, form: FormData) {
  const response = await fetch("/action/" + name, { method: "POST", body: form });
  if (!response.ok) throw Error("Fixture request failed");
  return response.json();
}
export const inspectKnowledgeUpload = (f: FormData) => send("inspect", f);
export const validateKnowledgeUpload = (f: FormData) => send("validate", f);
export const previewAcademy = () => send("academy", new FormData());
export const updateKnowledge = (_state: unknown, f: FormData) => send("review", f);
