import * as hono from "@hono/hono";
// webhook for receiving push events from GitHub
const config: Record<string, string | Record<string, string> | string[]> = {};
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
}
async function handle_post(c: hono.Context): Promise<Response> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
        headers[key] = value as string;
    }
    const body = await c.req.text();
    logAll(c, headers, body);
    const signature = headers["x-hub-signature-256"] || "";
    if (await verifySignature(body, signature)) {
        try {
            const payload = JSON.parse(body);
            // Check if it's a push to the production branch
            if (payload.ref) {
                const deploy_script = `${config["DEPLOY_COMMAND"]}-${
                    c.req.path.split("/").pop()
                }`;
                console.log("Deploying by calling: " + deploy_script);
                // Execute deployment command
                const command = new Deno.Command("sh", {
                    args: ["-c", deploy_script],
                });

                const { code, stdout, stderr } = await command.output();

                if (code === 0) {
                    console.log("Deployment successful");
                } else {
                    console.error("Deployment failed");
                }
                console.log("out: " + new TextDecoder().decode(stdout));
                console.log("err:" + new TextDecoder().decode(stderr));
            } else {
                console.log("no .ref on payload");
            }
        } catch (error) {
            console.error("Error processing webhook:", error);
        }
        return c.text("Webhook received", { status: 200 });
    } else {
        console.warn("Invalid signature");
        return c.text("Invalid signature", { status: 403 });
    }
}
const app = new hono.Hono().basePath(config["MOUNTPOINT"] as string); // "webhooks"
app.get("/", (c) => c.text(`Webhook server running on port ${PORT}`));
for (const endpoint of config["ENDPOINTS"]) {
    app.post(`/${endpoint}`, handle_post);
}
Deno.serve({
    port: PORT,
    hostname: "localhost",
}, app.fetch);
