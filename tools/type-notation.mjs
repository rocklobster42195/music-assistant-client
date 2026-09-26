// Translates the type notation in Music Assistant's /api-docs/commands.json into TypeScript.
// Examples of what the server writes:
//   "Array of (Track | Radio)"  "object with string keys and Any values"  "<enum 'MediaType"
//   "AsyncGenerator[PodcastEpisode]"  "MediaCollection[~ItemCls]"  "Array of (string | None, str)"
//   "set[DashboardType]"  "object with string keys and 'ConfigValueType' values"

const PRIMITIVES = {
    string: "string",
    str: "string",
    integer: "number",
    int: "number",
    number: "number",
    float: "number",
    boolean: "boolean",
    bool: "boolean",
    None: "null",
    null: "null",
    Any: "unknown",
    object: "Record<string, unknown>",
};
/** Generic wrappers that are plain lists on the wire (partial results are joined by the client). */
const LISTS = new Set(["AsyncGenerator", "Sequence", "set", "list", "Iterable", "tuple"]);

/**
 * @param {string} notation   type as written in commands.json
 * @param {(name: string) => string | undefined} resolve   model name → TS type (undefined = unknown model)
 * @returns {string} TypeScript type
 */
export function toTs(notation, resolve) {
    const tokens = tokenize(notation);
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    const expect = (t) => {
        if (next() !== t) throw new Error(`expected "${t}" in: ${notation}`);
    };

    function union(stopWord) {
        const parts = [term(stopWord)];
        while (peek() === "|") {
            next();
            parts.push(term(stopWord));
        }
        return join(parts);
    }

    function term(stopWord) {
        const t = next();
        if (t === undefined) throw new Error(`unexpected end: ${notation}`);
        if (t === "(") {
            // "(A | B)" group, or "(A, B)" tuple
            const items = [union()];
            while (peek() === ",") {
                next();
                items.push(union());
            }
            expect(")");
            return items.length > 1 ? `[${items.join(", ")}]` : items[0];
        }
        if (t === "Array" && peek() === "of") {
            next();
            const inner = term(stopWord);
            // "Array of (a, b)" is how the server prints a tuple — it is the tuple itself
            return inner.startsWith("[") ? inner : `${wrap(inner)}[]`;
        }
        if (t === "object" && peek() === "with") {
            for (const w of ["with", "string", "keys", "and"]) expect(w);
            const value = union("values");
            expect("values");
            return `Record<string, ${value}>`;
        }
        if (t === "<enum") return model(next().replace(/^'/, ""));
        if (t.startsWith("'") && t.endsWith("'")) return model(t.slice(1, -1));
        if (peek() === "[") {
            next();
            const args = [union()];
            while (peek() === ",") {
                next();
                args.push(union());
            }
            expect("]");
            if (LISTS.has(t)) return `${wrap(args.length > 1 ? join(args) : args[0])}[]`;
            return model(t); // e.g. MediaCollection[Audiobook] → MediaCollection
        }
        if (t === stopWord) throw new Error(`empty type before "${stopWord}": ${notation}`);
        return model(t);
    }

    function model(name) {
        if (name in PRIMITIVES) return PRIMITIVES[name];
        if (name.startsWith("~")) return resolve("MediaItemType") ?? "unknown"; // generic type variable
        return resolve(name) ?? "unknown";
    }

    const out = union();
    if (i < tokens.length) throw new Error(`trailing "${tokens.slice(i).join(" ")}" in: ${notation}`);
    return out;
}

function tokenize(s) {
    return s.match(/<enum|'[^']*'?|[()[\],|]|[^\s()[\],|]+/g) ?? [];
}

/** Join union members, dropping duplicates and collapsing `unknown`. */
function join(parts) {
    const unique = [...new Set(parts)];
    if (unique.includes("unknown")) return "unknown";
    return unique.join(" | ");
}

/** Parenthesize unions/functions before appending []. */
function wrap(t) {
    return /[|&]/.test(t) && !/^[[(]/.test(t) ? `(${t})` : t;
}
