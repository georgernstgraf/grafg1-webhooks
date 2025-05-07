const PORT = Deno.env.get("PORT") || throwError("PORT not in .env");
const SECRET = Deno.env.get("SECRET") || throwError("SECRET not in .env");
const DEPLOY_COMMAND = Deno.env.get("DEPLOY_COMMAND") ||
    throwError("DEPLOY_COMMAND not in .env");

function throwError(message: string): never {
    throw new Error(message);
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

async function handleRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
        const body = await request.text();
        const signature = request.headers.get("x-hub-signature-256") || "";

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
        } else {
            console.warn("Invalid signature");
        }

        return new Response("Webhook received", { status: 200 });
    }

    return new Response("Webhook server running", { status: 200 });
}

console.log(`Webhook server running on port ${PORT}`);
await Deno.serve({ port: PORT }, handleRequest);
