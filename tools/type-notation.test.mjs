import { describe, expect, it } from "vitest";
import { toTs } from "./type-notation.mjs";

const models = new Set(["Track", "Radio", "MediaType", "ConfigValueType", "PodcastEpisode", "DashboardType", "MediaCollection", "Audiobook", "MediaItemType"]);
const resolve = (n) => (models.has(n) ? n : undefined);
const ts = (s) => toTs(s, resolve);

describe("MA type notation → TypeScript", () => {
    it("primitives, models and unions", () => {
        expect(ts("string")).toBe("string");
        expect(ts("integer | string")).toBe("number | string");
        expect(ts("Track")).toBe("Track");
        expect(ts("string | None")).toBe("string | null");
        expect(ts("Nope")).toBe("unknown");
    });

    it("arrays, groups and tuples", () => {
        expect(ts("Array of string")).toBe("string[]");
        expect(ts("Array of (Track | Radio)")).toBe("(Track | Radio)[]");
        expect(ts("Array of (string | None, str)")).toBe("[string | null, string]");
        expect(ts("Array of (string | integer)")).toBe("(string | number)[]");
    });

    it("records", () => {
        expect(ts("object with string keys and Any values")).toBe("Record<string, unknown>");
        expect(ts("object with string keys and 'ConfigValueType' values")).toBe("Record<string, ConfigValueType>");
        expect(ts("object with string keys and boolean | number | Array of string values")).toBe("Record<string, boolean | number | string[]>");
        expect(ts("object with string keys and object with string keys and integer values values")).toBe("Record<string, Record<string, number>>");
    });

    it("enums, generics and type variables", () => {
        expect(ts("<enum 'MediaType")).toBe("MediaType");
        expect(ts("set[DashboardType]")).toBe("DashboardType[]");
        expect(ts("AsyncGenerator[Track | Radio | PodcastEpisode]")).toBe("(Track | Radio | PodcastEpisode)[]");
        expect(ts("MediaCollection[~ItemCls]")).toBe("MediaCollection");
        expect(ts("Array of ~ItemCls | Array of (~ItemCls | MediaCollection[~ItemCls])")).toBe("MediaItemType[] | (MediaItemType | MediaCollection)[]");
        expect(ts("Array of Audiobook | Array of (Audiobook | MediaCollection[Audiobook])")).toBe("Audiobook[] | (Audiobook | MediaCollection)[]");
    });

    it("rejects garbage", () => {
        expect(() => ts("Array of (string")).toThrow();
    });
});
