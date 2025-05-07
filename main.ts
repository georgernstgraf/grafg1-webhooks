import * as hono from "@hono/hono";

const PORT = Number(Deno.env.get("PORT")) || errExit("PORT not in .env");
const SECRET = Deno.env.get("SECRET") || errExit("SECRET not in .env");
const DEPLOY_COMMAND = Deno.env.get("DEPLOY_COMMAND") ||
    errExit("DEPLOY_COMMAND not in .env");
const MOUNTPOINT = Deno.env.get("MOUNTPOINT") ||
    errExit("MOUNTPOINT not in .env");

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

const app = new hono.Hono().basePath(MOUNTPOINT);
app.get("/", (c) => c.text(`Webhook server running on port ${PORT}`));
app.post("/graphsupply", async (c) => {
    // Log full request details
    console.log("===== WEBHOOK REQUEST RECEIVED =====");
    console.log(`Time: ${new Date().toISOString()}`);
    console.log("Method:", c.req.method);
    console.log("URL:", c.req.url);

    // Log all headers
    console.log("=== HEADERS ===");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
        console.log(`${key}: ${value}`);
        headers[key] = value as string;
    }

    // Get and log raw body
    const body = await c.req.text();
    console.log("=== BODY ===");
    console.log(body);
    console.log("======================================");

    const signature = headers["x-hub-signature-256"] || "";
    if (await verifySignature(body, signature)) {
        try {
            const payload = JSON.parse(body);
            // Check if it's a push to the production branch
            if (
                payload.ref === "refs/heads/prod" ||
                payload.ref === "refs/heads/production"
            ) {
                console.log("Deploying...");

                // Execute deployment command
                const command = new Deno.Command("sh", {
                    args: ["-c", DEPLOY_COMMAND],
                });

                const { code, stdout, stderr } = await command.output();

                if (code === 0) {
                    console.log("Deployment successful");
                    console.log(new TextDecoder().decode(stdout));
                } else {
                    console.error("Deployment failed");
                    console.error(new TextDecoder().decode(stderr));
                }
            }
        } catch (error) {
            console.error("Error processing webhook:", error);
        }
        return c.text("Webhook received", { status: 200 });
    } else {
        console.warn("Invalid signature");
        return c.text("Invalid signature", { status: 403 });
    }
});
Deno.serve({
    port: PORT,
    hostname: "localhost",
}, app.fetch);
