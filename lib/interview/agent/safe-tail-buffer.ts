export type SafeTailBuffer = {
  acceptValidated(cumulativeText: string): string;
  finishValidated(finalText: string): string;
};

export function createSafeTailBuffer(tailCharacters: number): SafeTailBuffer {
  if (!Number.isInteger(tailCharacters) || tailCharacters <= 0) {
    throw new RangeError("tailCharacters must be a positive integer");
  }

  let acceptedText = "";
  let releasedCharacters = 0;

  return {
    acceptValidated(cumulativeText) {
      if (!cumulativeText.startsWith(acceptedText)) {
        throw new Error("Safe-tail text must grow monotonically");
      }
      acceptedText = cumulativeText;
      const characters = [...acceptedText];
      const nextReleasedCharacters = Math.max(0, characters.length - tailCharacters);
      const released = characters.slice(releasedCharacters, nextReleasedCharacters).join("");
      releasedCharacters = nextReleasedCharacters;
      return released;
    },
    finishValidated(finalText) {
      if (finalText !== acceptedText) {
        throw new Error("Final validated text does not match the safe-tail buffer");
      }
      const characters = [...acceptedText];
      const released = characters.slice(releasedCharacters).join("");
      releasedCharacters = characters.length;
      return released;
    },
  };
}
