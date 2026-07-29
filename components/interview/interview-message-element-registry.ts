export type InterviewMessageElementRegistry<ElementType> = {
  register: (messageId: string, element: ElementType) => void;
  unregister: (messageId: string) => void;
  get: (messageId: string) => ElementType | null;
};

export function createInterviewMessageElementRegistry<ElementType>(): InterviewMessageElementRegistry<ElementType> {
  const elements = new Map<string, ElementType>();

  return {
    register(messageId, element) {
      elements.set(messageId, element);
    },
    unregister(messageId) {
      elements.delete(messageId);
    },
    get(messageId) {
      return elements.get(messageId) ?? null;
    },
  };
}
