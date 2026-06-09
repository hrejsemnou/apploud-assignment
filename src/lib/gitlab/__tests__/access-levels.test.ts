import { describe, it, expect } from "vitest";
import { accessLevelToString } from "../access-levels";

describe("accessLevelToString", () => {
  it("maps 50 to Owner", () => {
    expect(accessLevelToString(50)).toBe("Owner");
  });

  it("maps 30 to Developer", () => {
    expect(accessLevelToString(30)).toBe("Developer");
  });

  it("maps 10 to Guest", () => {
    expect(accessLevelToString(10)).toBe("Guest");
  });

  it("maps 40 to Maintainer", () => {
    expect(accessLevelToString(40)).toBe("Maintainer");
  });

  it("maps 20 to Reporter", () => {
    expect(accessLevelToString(20)).toBe("Reporter");
  });

  it("maps 5 to Minimal Access", () => {
    expect(accessLevelToString(5)).toBe("Minimal Access");
  });

  it("maps 15 to Planner", () => {
    expect(accessLevelToString(15)).toBe("Planner");
  });

  it("maps 25 to Security Manager", () => {
    expect(accessLevelToString(25)).toBe("Security Manager");
  });

  it("returns Unknown for unrecognized level", () => {
    expect(accessLevelToString(99)).toBe("Unknown");
  });
});