async function send(name: string, form: FormData) {
  const response = await fetch("/action/" + name, { method: "POST", body: form });
  if (!response.ok) throw Error("Fixture request failed");
  return response.json();
}
export const inspectKnowledgeUpload = (f: FormData) => send("inspect", f);
export const validateKnowledgeUpload = (f: FormData) => send("validate", f);
export const previewAcademy = () => send("academy", new FormData());
export const updateKnowledge = (_state: unknown, f: FormData) => send("review", f);
function payload(value: unknown) {
  const f = new FormData();
  f.set("payload", JSON.stringify(value));
  return f;
}
export const uploadGatewaySource = (form: FormData) => send("gateway-upload", form);
export const loadGatewayUpload = (id: string) => send("gateway-load", payload(id));
export const saveGatewayReview = (input: unknown) => send("gateway-review", payload(input));
export const commitGatewayUpload = (input: unknown) => send("gateway-save", payload(input));
export const discardGatewayUpload = (id: string) => send("gateway-discard", payload(id));
export const updateGatewayKnowledge = (input: unknown) => send("gateway-edit", payload(input));
export const approveGatewayKnowledge = (input: unknown) => send("gateway-approve", payload(input));
export const addApprovedKnowledge = (input: unknown) => send("path-add", payload(input));
export const publishLearningRevision = (input: unknown) => send("learning-publish", payload(input));
export const beginLearningRevision = (input: unknown) => send("learning-draft", payload(input));
export const recordLearningProgress = (input: unknown) => send("learning-progress", payload(input));
export const createRevisionGuide = (input: unknown) => send("guide-create", payload(input));
export const fetchKnowledge = (input: unknown) => send("knowledge-fetch", payload(input));
export const discardDraftGroup = (input: unknown) => send("draft-discard", payload(input));
export async function signOutAction() {
  await fetch("/fixture/logout", { method: "POST" });
  // This isolated Vite fixture has no Next router. Production uses the real Auth action.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/marketing");
}
export const createCourse = async (_state: unknown, form: FormData) => {
  const result = await send("course-create", form);
  if (result.success) window.dispatchEvent(new Event("fixture-refresh"));
  return result;
};
export const createKnowledge = () => Promise.reject(Error("Not used by this fixture"));
export const requestWorkflow = () => Promise.reject(Error("Not used by this fixture"));
export const updateOrganization = () => Promise.reject(Error("Not used by this fixture"));
