export function revalidatePath() {}
export function useRouter() {
  return {
    refresh() {
      window.dispatchEvent(new Event("fixture-refresh"));
    },
  };
}
