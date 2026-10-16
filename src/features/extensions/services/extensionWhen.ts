export type ExtensionWhenContext = {
    unit: {
        kind: "sticker" | "art" | null;
        hasImage: boolean;
    };
    attachmentTypes: ReadonlySet<string>;
};

type TokenKind = "identifier" | "string" | "boolean" | "operator" | "punctuation" | "end";
type Token = { kind: TokenKind; value: string };
type ValueNode =
    | { type: "literal"; value: string | boolean }
    | { type: "property"; key: "unit.kind" | "unit.hasImage" };
type ExpressionNode =
    | { type: "value"; value: ValueNode }
    | { type: "hasAttachment"; typeId: string }
    | { type: "not"; operand: ExpressionNode }
    | { type: "and" | "or"; left: ExpressionNode; right: ExpressionNode }
    | { type: "equal" | "notEqual"; left: ValueNode; right: ValueNode };

const MAX_TOKENS = 256;
const MAX_NODES = 128;
const MAX_DEPTH = 16;
const SUPPORTED_PROPERTIES = new Set(["unit.kind", "unit.hasImage"]);

const tokenize = (source: string): Token[] => {
    if (source.length > 2048) throw new Error("extension when expression exceeds 2048 characters");
    const tokens: Token[] = [];
    let offset = 0;
    const push = (token: Token) => {
        tokens.push(token);
        if (tokens.length > MAX_TOKENS) throw new Error("extension when expression exceeds token budget");
    };
    while (offset < source.length) {
        const character = source[offset];
        if (/\s/u.test(character)) {
            offset += 1;
            continue;
        }
        const pair = source.slice(offset, offset + 2);
        if (["&&", "||", "==", "!="].includes(pair)) {
            push({ kind: "operator", value: pair });
            offset += 2;
            continue;
        }
        if (character === "!") {
            push({ kind: "operator", value: character });
            offset += 1;
            continue;
        }
        if (["(", ")", ","].includes(character)) {
            push({ kind: "punctuation", value: character });
            offset += 1;
            continue;
        }
        if (character === '"' || character === "'") {
            const quote = character;
            let value = "";
            offset += 1;
            while (offset < source.length && source[offset] !== quote) {
                if (source[offset] === "\\") {
                    offset += 1;
                    if (offset >= source.length || !["\\", quote].includes(source[offset])) {
                        throw new Error("extension when string contains an unsupported escape");
                    }
                }
                value += source[offset];
                offset += 1;
            }
            if (source[offset] !== quote) throw new Error("extension when string is unterminated");
            offset += 1;
            push({ kind: "string", value });
            continue;
        }
        const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/u.exec(source.slice(offset))?.[0];
        if (identifier) {
            push({
                kind: identifier === "true" || identifier === "false" ? "boolean" : "identifier",
                value: identifier,
            });
            offset += identifier.length;
            continue;
        }
        throw new Error(`extension when expression contains unsupported token at ${offset}`);
    }
    tokens.push({ kind: "end", value: "" });
    return tokens;
};

class Parser {
    private offset = 0;
    private nodes = 0;
    private unsupported = false;

    constructor(private readonly tokens: readonly Token[]) {}

    parse(): ExpressionNode {
        const expression = this.parseOr(0);
        if (this.current().kind !== "end") throw new Error("extension when expression has trailing tokens");
        return expression;
    }

    /**
     * Reports whether the expression named a property this host does not implement.
     *
     * A plugin built against a newer contribution vocabulary is the expected
     * source. Substituting a false literal for the unknown property is not safe
     * on its own: `!unit.futureFlag` would then evaluate true and reveal a
     * contribution the author meant to hide, so the caller discards the whole
     * predicate instead.
     */
    hasUnsupportedProperty(): boolean {
        return this.unsupported;
    }

    private parseOr(depth: number): ExpressionNode {
        let left = this.parseAnd(depth + 1);
        while (this.match("||")) left = this.node({ type: "or", left, right: this.parseAnd(depth + 1) }, depth);
        return left;
    }

    private parseAnd(depth: number): ExpressionNode {
        let left = this.parseComparison(depth + 1);
        while (this.match("&&")) left = this.node({ type: "and", left, right: this.parseComparison(depth + 1) }, depth);
        return left;
    }

    private parseComparison(depth: number): ExpressionNode {
        if (this.match("!")) return this.node({ type: "not", operand: this.parseComparison(depth + 1) }, depth);
        if (this.match("(")) {
            const expression = this.parseOr(depth + 1);
            this.expect(")");
            return expression;
        }
        if (this.current().value === "attachment.has") {
            this.offset += 1;
            this.expect("(");
            const typeId = this.current();
            if (typeId.kind !== "string" || !typeId.value) {
                throw new Error("attachment.has requires a non-empty string");
            }
            this.offset += 1;
            this.expect(")");
            return this.node({ type: "hasAttachment", typeId: typeId.value }, depth);
        }
        const left = this.parseValue();
        if (this.match("==")) return this.node({ type: "equal", left, right: this.parseValue() }, depth);
        if (this.match("!=")) return this.node({ type: "notEqual", left, right: this.parseValue() }, depth);
        return this.node({ type: "value", value: left }, depth);
    }

    private parseValue(): ValueNode {
        const token = this.current();
        this.offset += 1;
        if (token.kind === "string") return { type: "literal", value: token.value };
        if (token.kind === "boolean") return { type: "literal", value: token.value === "true" };
        if (token.kind !== "identifier") throw new Error("extension when expression requires a value");
        if (!SUPPORTED_PROPERTIES.has(token.value)) {
            this.unsupported = true;
            return { type: "literal", value: false };
        }
        return { type: "property", key: token.value as "unit.kind" | "unit.hasImage" };
    }

    private current(): Token {
        return this.tokens[this.offset] ?? { kind: "end", value: "" };
    }

    private match(value: string): boolean {
        if (this.current().value !== value) return false;
        this.offset += 1;
        return true;
    }

    private expect(value: string): void {
        if (!this.match(value)) throw new Error(`extension when expression requires ${value}`);
    }

    private node<T extends ExpressionNode>(node: T, depth: number): T {
        if (depth > MAX_DEPTH) throw new Error("extension when expression exceeds depth budget");
        this.nodes += 1;
        if (this.nodes > MAX_NODES) throw new Error("extension when expression exceeds node budget");
        return node;
    }
}

const valueOf = (node: ValueNode, context: ExtensionWhenContext): string | boolean | null => {
    if (node.type === "literal") return node.value;
    return node.key === "unit.kind" ? context.unit.kind : context.unit.hasImage;
};

const valueKind = (node: ValueNode): "boolean" | "string" => {
    if (node.type === "literal") return typeof node.value === "boolean" ? "boolean" : "string";
    return node.key === "unit.hasImage" ? "boolean" : "string";
};

const validateBooleanExpression = (node: ExpressionNode): void => {
    switch (node.type) {
        case "value":
            if (valueKind(node.value) !== "boolean") {
                throw new Error("extension when predicate requires a boolean value");
            }
            return;
        case "hasAttachment": return;
        case "not": return validateBooleanExpression(node.operand);
        case "and":
        case "or":
            validateBooleanExpression(node.left);
            validateBooleanExpression(node.right);
            return;
        case "equal":
        case "notEqual":
            if (valueKind(node.left) !== valueKind(node.right)) {
                throw new Error("extension when comparison requires compatible values");
            }
    }
};

const evaluate = (node: ExpressionNode, context: ExtensionWhenContext): boolean => {
    switch (node.type) {
        case "value": return valueOf(node.value, context) === true;
        case "hasAttachment": return context.attachmentTypes.has(node.typeId);
        case "not": return !evaluate(node.operand, context);
        case "and": return evaluate(node.left, context) && evaluate(node.right, context);
        case "or": return evaluate(node.left, context) || evaluate(node.right, context);
        case "equal": return valueOf(node.left, context) === valueOf(node.right, context);
        case "notEqual": return valueOf(node.left, context) !== valueOf(node.right, context);
    }
};

export type ExtensionWhenPredicate = (context: ExtensionWhenContext) => boolean;

export const compileExtensionWhen = (source: string | undefined): ExtensionWhenPredicate => {
    if (!source?.trim()) return () => true;
    const parser = new Parser(tokenize(source));
    const expression = parser.parse();
    // Rejecting the expression here rather than throwing keeps one forward-looking
    // contribution from invalidating the whole snapshot: only the contribution
    // that asked for an unknown property disappears.
    if (parser.hasUnsupportedProperty()) return () => false;
    validateBooleanExpression(expression);
    return (context) => evaluate(expression, context);
};
