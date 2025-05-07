import * as hono from "@hono/hono";
// webhook for receiving push events from GitHub
type Config = {
    PORT: string;
    SECRET: string;
    DEPLOY_COMMAND: string;
    MOUNTPOINT: string;
    ENDPOINTS: string[] | string;
    BRANCHES: Record<string, string>;
    [key: string]: string | string[] | Record<string, string>;
};

const config: Config = {} as Config;
const env_vars = [
    "PORT",
    "SECRET",
    "DEPLOY_COMMAND",
    "MOUNTPOINT",
    "ENDPOINTS", // comma-separated list of endpoints, they have "-" in them
];
for (const var_name of env_vars) {
    const var_value = Deno.env.get(var_name);
    if (!var_value) errExit(`${var_name} not in .env`);
    config[var_name] = var_value;
}
config["ENDPOINTS"] = (config["ENDPOINTS"] as string).split(/, */);
config["BRANCHES"] = {};
for (const endpoint of config["ENDPOINTS"]) {
    // eg ["graphsupply", "quiz-2ahwii-sj2425"]
    const branch = Deno.env.get(`BRANCH_${endpoint.replaceAll("-", "_")}`);
    if (!branch) errExit(`BRANCH_${endpoint} not in .env`);
    config["BRANCHES"][endpoint] = branch;
}
console.log("Config loaded");
console.log(JSON.stringify(config, null, 4));
// Deno.exit(0);
const PORT = parseInt(config["PORT"] as string, 10);
function errExit(message: string): never {
    console.error(message);
    Deno.exit(1);
}
async function verifySignature(
    payload: string,
    signature: string,
): Promise<boolean> {
    if (!signature || !signature.startsWith("sha256=")) {
        return false;
    }
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(config["SECRET"] as string),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );

    const expectedSignature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
    );

    const receivedSignature = signature.replace("sha256=", "");

    // Convert expected signature to hex string
    const expectedHex = Array.from(new Uint8Array(expectedSignature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return expectedHex === receivedSignature;
}

function logAll(c: hono.Context, headers: object, body: string): void {
    // Get and log raw body
    console.log("===== WEBHOOK REQUEST RECEIVED =====");
    console.log(`Time: ${new Date().toISOString()}`);
    console.log("Method:", c.req.method);
    console.log("URL:", c.req.url);
    console.log("PATH:", c.req.path);
    // Log all headers
    console.log("=== HEADERS ===");
    for (const [key, value] of Object.entries(headers)) {
        console.log(`${key}: ${value}`);
    }
    // Get and log raw body
    console.log("=== BODY ===");
    console.log(body);
    console.log("======================================");
    console.log(Deno.env.toObject());
    console.log("======================================");
}
async function handle_post(c: hono.Context): Promise<Response> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
        headers[key] = value as string;
    }
    let message = "Thanks for calling! - ";
    try {
        const body = await c.req.text();
        logAll(c, headers, body);
        const signature = headers["x-hub-signature-256"] || "";
        if (!await verifySignature(body, signature)) {
            console.warn("401 Invalid signature");
            return c.text("Invalid signature", { status: 401 });
        }
        const payload = JSON.parse(body);
        if (!payload.ref) {
            console.log("400 no .ref on payload");
            return c.text("No ref on payload", { status: 400 });
        }
        if (!payload.repository?.name) {
            console.log("400 no .repository.name on payload");
            return c.text("No repository.name on payload", { status: 400 });
        }
        const pushed_branch = payload.ref.split("/").pop();
        const pushed_repo = payload.repository.name;
        const prod_branch = config["BRANCHES"][pushed_repo];
        const deploy_script = `${config["DEPLOY_COMMAND"]}-${pushed_repo}`;
        console.log({ pushed_branch, pushed_repo, prod_branch, deploy_script });
        if (prod_branch !== pushed_branch) {
            console.log("different branch pushed, ignoring");
            return c.text("Different branch pushed, ignoring", { status: 200 });
        }
        console.log("now deploying");
        const command = new Deno.Command("sh", {
            args: ["-c", deploy_script],
        });
        const { code, stdout, stderr } = await command.output();
        console.log({ code, stdout, stderr });
    } catch (err) {
        console.error("Error processing webhook:", err);
        message += (err as Error).message;
    }
    console.log("My Message to github:", message);
    return c.text(message, { status: 200 });
}
const app = new hono.Hono().basePath(config["MOUNTPOINT"] as string); // "webhooks"
app.get("/", (c) => c.text(`Webhook server running on port ${PORT}`));
app.post("/", handle_post);
Deno.serve({
    port: PORT,
    hostname: "localhost",
}, app.fetch);
