export interface TextAnalysis {
	characters: number;
	reversed: string;
	words: number;
}

/** Analyzes text using user-perceived grapheme clusters for character operations. */
export async function analyzeText(text: string): Promise<TextAnalysis> {
	if (typeof text !== "string") throw new Error("Text input must be a string");
	const graphemes = Array.from(
		new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		({ segment }) => segment,
	);
	return {
		characters: graphemes.length,
		reversed: graphemes.reverse().join(""),
		words: text.trim().split(/\s+/).filter(Boolean).length,
	};
}
