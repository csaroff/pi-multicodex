import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const storageSource = readFileSync(
	new URL("./storage.ts", import.meta.url),
	"utf8",
);

describe("extension startup", () => {
	it("loads the extension entrypoint instead of the public barrel", () => {
		expect(packageJson.pi.extensions).toEqual(["./extension.ts"]);
	});

	it("validates account storage without loading the schema generator", () => {
		expect(storageSource).not.toMatch(/from ["']zod["']/);
	});
});
