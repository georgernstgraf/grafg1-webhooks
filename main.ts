import * as hono from "@hono/hono";
// webhook for receiving push events from GitHub
const PORT = Number(Deno.env.get("PORT")) || errExit("PORT not in .env");
const SECRET = Deno.env.get("SECRET") || errExit("SECRET not in .env");
const DEPLOY_COMMAND = Deno.env.get("DEPLOY_COMMAND") ||
    errExit("DEPLOY_COMMAND not in .env");
const MOUNTPOINT = Deno.env.get("MOUNTPOINT") ||
    errExit("MOUNTPOINT not in .env");
const BRANCH = Deno.env.get("BRANCH") || errExit("BRANCH not in .env");

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
        new TextEncoder().encode(SECRET),
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
                const deploy_script = `${DEPLOY_COMMAND}-${
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
const app = new hono.Hono().basePath(MOUNTPOINT); // "webhooks"
app.get("/", (c) => c.text(`Webhook server running on port ${PORT}`));
app.post("/graphsupply", handle_post);
app.post("/quiz-2ahwii-sj2425", handle_post);
Deno.serve({
    port: PORT,
    hostname: "localhost",
}, app.fetch);
