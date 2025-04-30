import { asError, errorString, throwError } from "./error";

describe("Error Utils", () => {
  describe("asError", () => {
    it("should return the same Error instance", () => {
      const err = new Error("Test error");
      expect(asError(err)).toBe(err);
    });

    it("should throw a new Error for non-Error input", () => {
      expect(() => asError({ message: "not an error" })).toThrow("Unknown object thrown as error");
    });
  });

  describe("errorString", () => {
    it("should return stack trace if available", () => {
      const err = new Error("Test error");
      const str = errorString(err);
      expect(str).toContain("Test error");
    });

    it("should handle error with cause", () => {
      const cause = new Error("Root cause");
      const err = new Error("Wrapper error", { cause });
      const str = errorString(err);
      expect(str).toContain("Root cause");
      expect(str).toContain("Wrapper error");
    });

    it("should handle non-error objects", () => {
      const str = errorString({ some: "object" });
      expect(str).toContain("Caught a non-error");
    });
  });

  describe("throwError", () => {
    it("should throw an Error with given message", () => {
      expect(() => throwError("fail")).toThrow("fail");
    });
  });
});
