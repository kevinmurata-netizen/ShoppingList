export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    const error = new Error(
      "Couldn’t reach your list. Check your connection and try again.",
    );
    error.network = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || "Couldn’t save that change. Please try again.",
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
