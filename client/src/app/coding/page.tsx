import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface LegacyCodingPageProps {
  searchParams: {
    replId?: string;
    lang?: string;
    language?: string;
  };
}

/**
 * Backwards-compatibility redirect from legacy `/coding?replId=...`
 * to the modern RESTful App Router dynamic path `/projects/[projectId]`
 */
export default function LegacyCodingRedirect({ searchParams }: LegacyCodingPageProps) {
  const replId = searchParams.replId;
  if (!replId) {
    redirect("/projects");
  }

  const lang = searchParams.lang || searchParams.language;
  const target = lang
    ? `/projects/${encodeURIComponent(replId)}?lang=${encodeURIComponent(lang)}`
    : `/projects/${encodeURIComponent(replId)}`;

  redirect(target);
}
