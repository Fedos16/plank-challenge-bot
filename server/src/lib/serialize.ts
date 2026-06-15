// Позволяет сериализовать BigInt в JSON (Telegram id, chatId) как строку.
// Импортируется один раз при старте процесса.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

export {};
