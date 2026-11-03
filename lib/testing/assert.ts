export function assert(
  value: unknown,
  message = "Assertion failed",
): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}
export async function rejects(operation: () => Promise<unknown>, text: string) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(text),
      `Expected error containing ${text}, received ${String(error)}`,
    );
    return;
  }
  throw new Error(`Expected rejection containing ${text}`);
}
