#!/usr/bin/env node

/**
 * Import this Mintlify help center into Crisp Helpdesk.
 *
 * The script reads the navigation in docs.json, then creates matching Crisp
 * locales, categories, and published articles. It uses only Node.js built-ins.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const requestedLocale = process.argv.find((arg) => arg.startsWith("--locale="))?.slice(9);
const execute = args.has("--execute");
const minimumRequestIntervalMs = 750;
const maximumRateLimitRetries = 7;
let lastRequestAt = 0;

if (args.has("--help")) {
  console.log(`Usage: node scripts/import-to-crisp.mjs [--locale=en] [--execute]

Without --execute, prints what would be imported without changing Crisp.

Required with --execute:
  CRISP_WEBSITE_ID  Crisp workspace identifier
  CRISP_TOKEN_ID    Crisp website token identifier
  CRISP_TOKEN_KEY   Crisp website token secret
`);
  process.exit(0);
}

const config = JSON.parse(await readFile(path.join(root, "docs.json"), "utf8"));
const languages = config.navigation?.languages ?? [];
const selectedLanguages = requestedLocale
  ? languages.filter(({ language }) => language === requestedLocale)
  : languages;

if (selectedLanguages.length === 0) {
  throw new Error(`No language named ${requestedLocale ?? "<none>"} is configured in docs.json.`);
}

const credentials = {
  websiteId: process.env.CRISP_WEBSITE_ID,
  tokenId: process.env.CRISP_TOKEN_ID,
  tokenKey: process.env.CRISP_TOKEN_KEY,
};

if (execute && Object.values(credentials).some((value) => !value)) {
  throw new Error("Set CRISP_WEBSITE_ID, CRISP_TOKEN_ID, and CRISP_TOKEN_KEY before using --execute.");
}

function frontmatterValue(source, name) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatter) throw new Error("Missing YAML frontmatter.");
  const line = frontmatter[1].match(new RegExp(`^${name}:\\s*[\\\"']?(.*?)[\\\"']?\\s*$`, "m"));
  return line?.[1]?.replace(/^['\"]|['\"]$/g, "") ?? "";
}

function crispMarkdown(source) {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return body
    .replace(/<(Tip|Note|Info|Warning|Check)>\s*([\s\S]*?)\s*<\/\1>/g, (_, kind, content) =>
      `> **${kind}:** ${content.trim().replace(/\n/g, "\n> ")}`,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;
  return Math.min(60_000, 2_000 * 2 ** attempt);
}

async function api(method, endpoint, body) {
  for (let attempt = 0; attempt <= maximumRateLimitRetries; attempt += 1) {
    const waitForPacing = Math.max(0, minimumRequestIntervalMs - (Date.now() - lastRequestAt));
    if (waitForPacing) await sleep(waitForPacing);
    lastRequestAt = Date.now();

    const response = await fetch(`https://api.crisp.chat/v1${endpoint}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.tokenId}:${credentials.tokenKey}`).toString("base64")}`,
        "Content-Type": "application/json",
        "X-Crisp-Tier": "website",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (response.status === 429 || response.status === 420) {
      if (attempt === maximumRateLimitRetries) {
        throw new Error(`${method} ${endpoint} remained rate-limited after ${maximumRateLimitRetries} retries.`);
      }
      const delay = retryDelay(response, attempt);
      console.warn(`Rate limited; retrying ${method} ${endpoint} in ${Math.ceil(delay / 1_000)} seconds.`);
      await sleep(delay);
      continue;
    }
    if (!response.ok || payload.error) {
      throw new Error(`${method} ${endpoint} failed (${response.status}): ${payload.reason ?? payload.raw ?? "unknown error"}`);
    }
    return payload.data;
  }
  throw new Error("Unexpected retry loop exit.");
}

async function ensureLocale(locale) {
  const locales = await api("GET", `/website/${credentials.websiteId}/helpdesk/locales/1`);
  if (!locales.some((entry) => entry.locale === locale)) {
    await api("POST", `/website/${credentials.websiteId}/helpdesk/locale`, { locale });
    console.log(`Created locale: ${locale}`);
  }
}

async function allCategories(locale) {
  const categories = [];
  for (let page = 1; ; page += 1) {
    const result = await api("GET", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/categories/${page}`);
    if (!result.length) return categories;
    categories.push(...result);
  }
}

async function ensureCategory(locale, name) {
  const existing = (await allCategories(locale)).find((category) => category.name === name);
  if (existing) return existing.category_id;
  const created = await api("POST", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/category`, { name });
  return created.category_id;
}

async function allArticles(locale) {
  const articles = [];
  for (let page = 1; ; page += 1) {
    const result = await api("GET", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/articles/${page}`);
    if (!result.length) return articles;
    articles.push(...result);
  }
}

for (const { language: locale, groups } of selectedLanguages) {
  const articles = [];
  for (const [categoryOrder, group] of groups.entries()) {
    for (const [articleOrder, page] of group.pages.entries()) {
      const relativeFile = `${page}.mdx`;
      const source = await readFile(path.join(root, relativeFile), "utf8");
      articles.push({
        category: group.group,
        categoryOrder,
        articleOrder,
        file: relativeFile,
        title: frontmatterValue(source, "title"),
        description: frontmatterValue(source, "description"),
        content: crispMarkdown(source),
      });
    }
  }

  if (!execute) {
    console.log(`${locale}: ${articles.length} articles in ${groups.length} categories`);
    for (const article of articles) console.log(`  [${article.category}] ${article.title} (${article.file})`);
    continue;
  }

  await ensureLocale(locale);
  const existingArticles = await allArticles(locale);
  const categoryIds = new Map();

  for (const article of articles) {
    if (!categoryIds.has(article.category)) {
      categoryIds.set(article.category, await ensureCategory(locale, article.category));
    }
    const existing = existingArticles.find((candidate) => candidate.title === article.title);
    const articleId = existing
      ? existing.article_id
      : (await api("POST", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/article`, { title: article.title })).article_id;

    await api("PUT", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/article/${articleId}`, {
      title: article.title,
      description: article.description,
      content: article.content,
      featured: false,
      order: article.articleOrder,
    });
    await api("PATCH", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/article/${articleId}/category`, {
      category_id: categoryIds.get(article.category),
    });
    await api("POST", `/website/${credentials.websiteId}/helpdesk/locale/${locale}/article/${articleId}/publish`, {});
    console.log(`${existing ? "Updated" : "Imported"}: ${locale}/${article.title}`);
  }
}
