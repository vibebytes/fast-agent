import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  GitFileChange,
  GitRepoStatus,
  GitStatus,
} from "@fast-ide/session-view";
import { cn } from "@fast-ide/ui/lib/utils";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { pathLabel } from "../session/path";

const KindLetter: Record<
  GitFileChange["kind"],
  { letter: string; labelKey: string; className: string }
> = {
  added: {
    letter: "A",
    labelKey: "shell.changes.kindAdded",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  deleted: {
    letter: "D",
    labelKey: "shell.changes.kindDeleted",
    className: "text-red-500 dark:text-red-400",
  },
  modified: {
    letter: "M",
    labelKey: "shell.changes.kindModified",
    className: "text-amber-600 dark:text-amber-400",
  },
};

function GitChangeRow({
  repo,
  file,
  onOpenDiff,
}: {
  repo: GitRepoStatus;
  file: GitFileChange;
  onOpenDiff?: (repoPath: string, path: string) => void;
}) {
  const { t } = useTranslation();
  const kind = KindLetter[file.kind];
  const label = pathLabel(file.path);
  const open = () => onOpenDiff?.(repo.path, file.path);

  return (
    <div
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs hover:bg-muted/40"
      role="button"
      tabIndex={0}
      data-testid={`git-change-${repo.path}:${file.path}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open();
      }}
    >
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "w-3 text-center font-mono text-[11px] font-bold",
          kind.className,
        )}
        title={t(kind.labelKey)}
      >
        {kind.letter}
      </span>
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] hover:underline"
        data-testid={`git-open-${repo.path}:${file.path}`}
        title={file.path}
      >
        {label.dir ? (
          <span className="text-muted-foreground">{label.dir}/</span>
        ) : null}
        <span className="font-medium">{label.name}</span>
      </span>
    </div>
  );
}

/** Repository-scoped working-tree changes. This pane is independent of agent checkpoint review. */
export function ChangesPane({
  status,
  onOpenDiff,
  onRefresh,
}: {
  status: GitStatus | null;
  onOpenDiff?: (repoPath: string, path: string) => void;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const repos = useMemo<GitRepoStatus[]>(() => {
    if (!status) return [];
    if (status.repos) return status.repos;
    return [
      {
        path: "",
        name: status.branch,
        branch: status.branch,
        files: status.files,
      },
    ];
  }, [status]);
  const fileCount = repos.reduce((count, repo) => count + repo.files.length, 0);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {fileCount === 1
              ? t("shell.changes.oneFile")
              : t("shell.changes.filesCount", { count: fileCount })}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {t("shell.changes.workingTree")}
          </p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("shell.changes.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!status ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("shell.changes.scmUnavailable")}
          </p>
        ) : fileCount === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">
              {t("shell.changes.scmEmptyTitle")}
            </p>
            <p>{t("shell.changes.scmEmptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {repos.map((repo) => (
              <section key={repo.path} className="flex flex-col gap-1.5">
                <header className="flex items-center gap-1.5 px-1 text-[11px]">
                  <span className="truncate font-semibold">{repo.name}</span>
                  <span className="truncate text-muted-foreground">
                    {repo.branch}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {repo.files.length}
                  </span>
                </header>
                {repo.files.map((file) => (
                  <GitChangeRow
                    key={`${repo.path}:${file.path}`}
                    repo={repo}
                    file={file}
                    onOpenDiff={onOpenDiff}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
