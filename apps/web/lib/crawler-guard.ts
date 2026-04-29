import { NextRequest } from "next/server";

const LOW_VALUE_ENDPOINT_CRAWLER_UA_PATTERN = /(meta-externalagent|meta-externalfetcher|metaexternalhit|facebookexternalhit|facebookcatalog|Googlebot|Google-InspectionTool|Bingbot|BingPreview|LinkedInBot|Twitterbot|Slackbot|Discordbot|DuckDuckBot|redditbot|applebot|SkypeUriPreview|WhatsApp|ia_archiver|GPTBot|vkShare|quora link preview)/i;

export function getRequestUserAgent(request: NextRequest) {
  return request.headers.get("user-agent") ?? "";
}

export function isObviousCrawlerUserAgent(userAgent: string) {
  if (!userAgent) {
    return false;
  }

  return LOW_VALUE_ENDPOINT_CRAWLER_UA_PATTERN.test(userAgent);
}

export function isObviousCrawlerRequest(request: NextRequest) {
  return isObviousCrawlerUserAgent(getRequestUserAgent(request));
}