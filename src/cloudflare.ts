const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

export interface MarkdownResult {
  markdown: string;
  url: string;
  success: boolean;
}

export async function fetchMarkdown(url: string, waitForJs?: boolean): Promise<MarkdownResult> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables are required for markdown extraction");
  }

  const body: Record<string, unknown> = { url };

  if (waitForJs) {
    body.gotoOptions = { waitUntil: "networkidle0" };
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/markdown`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CF_API_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare API error (${response.status}): ${text}`);
  }

  const data = await response.json() as { success: boolean; result: string };

  if (!data.success) {
    throw new Error("Cloudflare markdown extraction failed");
  }

  return {
    markdown: data.result,
    url,
    success: true,
  };
}
