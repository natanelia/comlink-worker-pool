import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForFunction(() => "browserChecks" in window);
});

test("runs real Comlink calls and confirms worker cleanup", async ({
	page,
}) => {
	const result = await page.evaluate(() =>
		window.browserChecks.parallelCalls(),
	);
	expect(result.values).toEqual(["a", "b", "c", "d"]);
	expect(result.report).toMatchObject({ confirmed: true });
});

test("recovers from a silent worker close and a wedged call", async ({
	page,
}) => {
	for (const check of ["crashRecovery", "hangRecovery"] as const) {
		const result = await page.evaluate(
			(name) => window.browserChecks[name](),
			check,
		);
		expect(result).toEqual({
			errorName: "WorkerTaskTimeoutError",
			recovered: "recovered",
			workersCreated: 2,
		});
	}
});

test("balances worker ownership under React StrictMode", async ({ page }) => {
	const result = await page.evaluate(() =>
		window.browserChecks.reactStrictMode(),
	);
	expect(result).toEqual({
		value: "react-ready",
		workersCreated: 1,
		workersTerminated: 1,
	});
});
