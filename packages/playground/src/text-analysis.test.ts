import { describe, expect, test } from "bun:test";
import { analyzeText } from "./text-analysis";

describe("analyzeText", () => {
	test("counts and reverses user-perceived characters", async () => {
		await expect(analyzeText("A💩é")).resolves.toEqual({
			characters: 3,
			reversed: "é💩A",
			words: 1,
		});
	});

	test("keeps joined emoji graphemes intact", async () => {
		const family = "👨‍👩‍👧‍👦";
		await expect(analyzeText(family)).resolves.toEqual({
			characters: 1,
			reversed: family,
			words: 1,
		});
	});
});
