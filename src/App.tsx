import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, MouseEvent, ReactNode } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";

type AttachmentType = "doc" | "video" | "link";
type ThemeName = "lavender" | "ocean" | "forest" | "sunset" | "rose" | "dark" | "dark-ocean" | "dark-forest" | "dark-warm";
type FontName = "pretendard" | "jua" | "system";
type SkinName = "monggle" | "minimal" | "retro" | "neon" | "paper" | "jelly" | "glass" | "galaxy" | "terminal" | "watercolor";
type PreviewMode = "auto" | "mobile";
type MobileRoute = "home" | "folder" | "leaf" | "stats" | "profile";

type Attachment = {
  id: string;
  type: AttachmentType;
  name: string;
  url?: string;
};

type StudyEntry = {
  id: string;
  date: string;
  title: string;
  body: string;
  attachments: Attachment[];
  tags: string[];
};

type StudyNode = {
  id: string;
  name: string;
  emoji: string;
  colorIndex?: number;
  open?: boolean;
  leaf?: boolean;
  entries?: StudyEntry[];
  children?: StudyNode[];
};

type Settings = {
  skin: SkinName;
  theme: ThemeName;
  font: FontName;
  sidebarWidth: number;
  navSize: number;
  bodySize: number;
  titleSize: number;
  obsidianVault: string;
};

type ModalState =
  | { kind: "entry"; nodeId: string; entryId?: string }
  | { kind: "category"; parentId?: string; leaf: boolean }
  | { kind: "emoji"; nodeId?: string; draftTarget?: "category" }
  | { kind: "settings" }
  | { kind: "confirmDelete"; nodeId: string }
  | null;

const STORE_KEY = "monggle-study-app-v1";
const SETTINGS_KEY = "monggle-study-settings-v1";

// 폴더(카테고리) 최대 깊이. 모든 카테고리는 하위 폴더와 기록(메모)을 함께 가질 수 있고,
// 폴더는 이 깊이까지만 중첩된다. (단계 구분 설정은 폐지 — 고정 상한)
const MAX_DEPTH = 4;

// 하위 카테고리를 가진 노드는 "컨테이너", 없는 노드는 "기록을 담는 끝 노드"다.
function hasChildren(node: StudyNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

// 모든 카테고리는 하위 폴더(분류)와 기록(메모)을 함께 가질 수 있다.
// - 하위 폴더 추가: 깊이가 MAX_DEPTH 미만일 때만 가능
// - 기록 추가: 항상 가능
function canAddCategory(depth: number): boolean {
  return depth < MAX_DEPTH;
}

// 옛 "기록함(leaf)" 개념 제거 마이그레이션.
// leaf 노드의 기록을 바로 위 부모 카테고리로 올리고, leaf 노드 자체는 삭제한다.
// 새 모델에선 한 카테고리가 하위 폴더와 기록을 함께 가질 수 있으므로 그대로 합친다(멱등).
function stripRecordBooks(nodes: StudyNode[]): StudyNode[] {
  return nodes.map((node) => {
    const children = node.children ?? [];
    const leafKids = children.filter((child) => child.leaf === true);
    const branchKids = children.filter((child) => child.leaf !== true);
    const hoisted = leafKids.flatMap((child) => child.entries ?? []);
    const { leaf: _leaf, ...rest } = node;
    return {
      ...rest,
      entries: [...(node.entries ?? []), ...hoisted],
      children: stripRecordBooks(branchKids),
    };
  });
}

// 스킨마다 고유한 "팡!" 파티클. cls 가 CSS(.p-*) 모션을, glyphs/colors 가 모양을 정한다.
type BurstSpec = {
  cls: string;
  glyphs?: string[];
  colors?: string[];
  count: number;
  distMin: number;
  distMax: number;
  rise: number;     // dy 보정 (음수=위로, 양수=아래로)
  delayMax: number; // 애니메이션 시작 지연 최대치(s)
  life: number;     // 제거 타이밍(ms)
};

const BURSTS: Record<SkinName, BurstSpec> = {
  monggle:    { cls: "",        glyphs: ["✨", "🎉", "⭐", "💫", "🌸", "💜"], count: 12, distMin: 40, distMax: 110, rise: -30, delayMax: 0.1,  life: 900 },
  minimal:    { cls: "p-ring",  count: 4,  distMin: 0,  distMax: 0,   rise: 0,   delayMax: 0.18, life: 700 },
  retro:      { cls: "p-pixel", colors: ["#ff5277", "#ffd23f", "#1fd1a5", "#3b82f6", "#a855f7"], count: 16, distMin: 30, distMax: 95,  rise: -22, delayMax: 0.06, life: 800 },
  neon:       { cls: "p-neon",  colors: ["#22d3ee", "#ff2fd0", "#39ff14", "#a855f7"], count: 18, distMin: 46, distMax: 120, rise: -12, delayMax: 0.08, life: 850 },
  paper:      { cls: "p-paper", colors: ["#e8dcc0", "#d8c8a0", "#f0e6d0", "#cdb892"], count: 11, distMin: 24, distMax: 80,  rise: 40,  delayMax: 0.12, life: 1100 },
  jelly:      { cls: "p-jelly", glyphs: ["💖", "🍬", "⭐", "🩷", "🫧"], count: 13, distMin: 40, distMax: 104, rise: -30, delayMax: 0.1,  life: 900 },
  glass:      { cls: "p-bubble", count: 13, distMin: 18, distMax: 70,  rise: -90, delayMax: 0.2,  life: 1200 },
  galaxy:     { cls: "p-star",  glyphs: ["⭐", "✦", "✨", "🌟", "·"], count: 16, distMin: 30, distMax: 120, rise: -20, delayMax: 0.12, life: 1000 },
  terminal:   { cls: "p-char",  glyphs: ["0", "1", "<", ">", "{", "}", "/", "$", "#", "*", "%"], colors: ["#39ff14"], count: 14, distMin: 10, distMax: 40, rise: 60, delayMax: 0.15, life: 1000 },
  watercolor: { cls: "p-blot",  colors: ["#f7a8b8", "#a8d8ea", "#c3f0ca", "#ffe6a7", "#d8b4f0"], count: 9, distMin: 18, distMax: 66, rise: 8, delayMax: 0.12, life: 1100 },
};

function burst(x: number, y: number) {
  const fx = document.getElementById("burst-fx");
  if (!fx) return;
  const skin = (document.documentElement.dataset.skin as SkinName) || "monggle";
  const spec = BURSTS[skin] ?? BURSTS.monggle;
  for (let i = 0; i < spec.count; i++) {
    const s = document.createElement("span");
    s.className = spec.cls ? `spark ${spec.cls}` : "spark";
    if (spec.glyphs) s.textContent = spec.glyphs[i % spec.glyphs.length];
    if (spec.colors) {
      const c = spec.colors[i % spec.colors.length];
      s.style.setProperty("--c", c);
      s.style.color = c;
    }
    s.style.left = x + "px";
    s.style.top = y + "px";
    const ang = Math.random() * 6.28;
    const dist = spec.distMin + Math.random() * (spec.distMax - spec.distMin);
    s.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    s.style.setProperty("--dy", Math.sin(ang) * dist + spec.rise + "px");
    s.style.animationDelay = Math.random() * spec.delayMax + "s";
    fx.appendChild(s);
    setTimeout(() => s.remove(), spec.life);
  }
}

const palette = [
  ["var(--accent)", "var(--accent-soft)"],
  ["var(--mint)", "var(--mint-soft)"],
  ["var(--peach)", "var(--peach-soft)"],
  ["var(--sky)", "var(--sky-soft)"],
  ["var(--rose)", "var(--rose-soft)"]
] as const;

const emojis = [
  "📁", "📂", "🗂️", "🗃️", "📦", "📚", "📖", "📕", "📗", "📘",
  "📙", "📔", "📓", "📒", "📑", "📄", "📝", "✏️", "🖊️", "🖋️",
  "🖍️", "📌", "📍", "🔖", "🏷️", "📋", "🗒️", "🗓️", "📅", "⏰",
  "⏳", "⌛", "💡", "🔦", "🕯️", "🔍", "🔎", "🧭", "🎯", "🧩",
  "🧠", "💭", "💬", "🗯️", "💻", "⌨️", "🖥️", "📱", "🔧", "⚙️",
  "🧪", "🔬", "📐", "📏", "🧮", "📊", "📈", "📉", "🗄️", "🔐",
  "🎨", "🖌️", "🖼️", "🎬", "🎧", "🎵", "🎹", "🎤", "🏆", "🏅",
  "🥇", "⭐", "🌟", "✨", "💫", "🌙", "☁️", "🌈", "🌸", "🌷",
  "🌼", "🌻", "🍀", "🌿", "🌱", "🍄", "🍓", "🍒", "🍑", "🍋",
  "🍬", "🍭", "🧁", "🍰", "☕", "🫖", "💜", "💛", "💙", "💗"
];

const defaultSettings: Settings = {
  skin: "monggle",
  theme: "lavender",
  font: "pretendard",
  sidebarWidth: 300,
  navSize: 16,
  bodySize: 14,
  titleSize: 30,
  obsidianVault: ""
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const id = (prefix = "id") => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const entry = (
  date: string,
  title: string,
  body: string,
  attachments: Omit<Attachment, "id">[] = [],
  tags: string[] = []
): StudyEntry => ({
  id: id("e"),
  date,
  title,
  body,
  attachments: attachments.map((a) => ({ ...a, id: id("a") })),
  tags
});

const initialData = (): StudyNode[] => [
  {
    id: id("n"),
    name: "코딩",
    emoji: "💻",
    colorIndex: 0,
    open: true,
    children: [
      {
        id: id("n"),
        name: "알고리즘",
        emoji: "🧩",
        open: true,
        children: [
          {
            id: id("n"),
            name: "정렬",
            emoji: "📑",
            open: true,
            children: [
              {
                id: id("n"),
                name: "정렬 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-18", "퀵정렬 다시 정리", "피벗 선택과 파티션 과정을 직접 손으로 트레이싱.\n- 평균 O(n log n), 최악 O(n²)\n- 피벗을 랜덤/중앙값으로 잡으면 최악 회피", [
                    { type: "doc", name: "quicksort.pdf" },
                    { type: "video", name: "정렬 시각화 영상" }
                  ], ["알고리즘", "정렬", "복잡도"]),
                  entry("2026-06-04", "병합정렬 vs 퀵정렬", "안정 정렬이 필요한 경우 병합정렬, 메모리 아끼려면 퀵정렬.\n- 병합정렬은 항상 O(n log n)\n- 퀵정렬은 캐시 효율이 더 좋음", [
                    { type: "doc", name: "compare-sort.md" }
                  ], ["알고리즘", "정렬"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "그래프",
            emoji: "🕸️",
            children: [
              {
                id: id("n"),
                name: "탐색 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-11", "BFS/DFS 손코딩", "인접리스트로 그래프 구현 후 두 탐색 방식 직접 짜보기.\n- BFS는 큐, DFS는 스택(재귀)\n- 최단경로엔 BFS가 유리", [
                    { type: "doc", name: "graph-notes.pdf" },
                    { type: "link", name: "시각화 사이트 ↗", url: "#" }
                  ], ["알고리즘", "그래프"]),
                  entry("2026-05-29", "다익스트라 첫 시도", "우선순위 큐로 최단거리 갱신. 음수 가중치 불가한 이유 메모.", [], ["알고리즘", "최단경로"])
                ]
              }
            ]
          }
        ]
      },
      {
        id: id("n"),
        name: "자료구조",
        emoji: "🗂️",
        children: [
          {
            id: id("n"),
            name: "트리와 힙",
            emoji: "🌲",
            children: [
              {
                id: id("n"),
                name: "힙 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-08", "이진 힙 구현", "배열로 힙 구현, 부모/자식 인덱스 공식 정리.\n- 부모: (i-1)/2\n- 자식: 2i+1, 2i+2", [
                    { type: "doc", name: "heap.js" }
                  ], ["자료구조", "힙"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "해시테이블",
            emoji: "#️⃣",
            children: [
              { id: id("n"), name: "해시 기록함", emoji: "📘", leaf: true, entries: [] }
            ]
          }
        ]
      }
    ]
  },
  {
    id: id("n"),
    name: "에이전트",
    emoji: "🤖",
    colorIndex: 1,
    open: true,
    children: [
      {
        id: id("n"),
        name: "오픈클로",
        emoji: "🐚",
        children: [
          {
            id: id("n"),
            name: "설치",
            emoji: "📦",
            children: [
              {
                id: id("n"),
                name: "설치 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-02", "로컬 설치 & 첫 실행", "바이너리 받아서 PATH 등록, 첫 명령 실행까지 단계별 메모.", [
                    { type: "doc", name: "install-log.md" }
                  ], ["설정", "오픈클로"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "플러그인",
            emoji: "🧩",
            children: [
              { id: id("n"), name: "플러그인 기록함", emoji: "📘", leaf: true, entries: [] }
            ]
          }
        ]
      },
      {
        id: id("n"),
        name: "헤르메스",
        emoji: "🪽",
        open: true,
        children: [
          {
            id: id("n"),
            name: "설정방법",
            emoji: "⚙️",
            children: [
              {
                id: id("n"),
                name: "설정 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-15", "환경변수 & 토큰 세팅", "OD_TOKEN 발급 후 .env 에 등록. 데몬 wrapper 로만 호출하는 규칙 메모.", [
                    { type: "doc", name: "setup-guide.md" }
                  ], ["설정", "헤르메스"]),
                  entry("2026-05-30", "멀티 인스턴스 설정", "포트 분리해서 인스턴스 두 개 띄워보기. 충돌 났던 이유는 동일 락파일 사용 때문.", [
                    { type: "link", name: "트러블슈팅 노트 ↗", url: "#" }
                  ], ["설정", "트러블슈팅"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "개념정리",
            emoji: "📘",
            open: true,
            children: [
              {
                id: id("n"),
                name: "개념 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-19", "헤르메스 메시지 라우팅 개념", "메시지가 채널→큐→핸들러로 흐르는 구조를 그림으로 정리.\n- 멱등성(idempotency) 키로 중복 처리 방지\n- 재시도는 지수 백오프", [
                    { type: "doc", name: "routing-diagram.png" },
                    { type: "video", name: "개념 설명 영상" },
                    { type: "link", name: "옵시디언 노트 ↗", url: "#" }
                  ], ["개념정리", "메시징"]),
                  entry("2026-06-13", "브로커 vs 브로커리스", "중앙 브로커 방식과 P2P 방식의 트레이드오프 비교 표 작성.", [
                    { type: "doc", name: "compare.xlsx" }
                  ], ["개념정리", "메시징"]),
                  entry("2026-06-09", "용어 첫 정리", "토픽, 파티션, 컨슈머 그룹 같은 기본 용어부터 한 줄씩.", [
                    { type: "link", name: "공식문서 ↗", url: "#" }
                  ], ["개념정리", "헤르메스"]),
                  entry("2026-05-27", "백프레셔 개념", "컨슈머가 못 따라갈 때 생산 속도를 조절하는 방법들 정리.", [
                    { type: "doc", name: "backpressure.md" }
                  ], ["개념정리", "메시징"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "크론조작",
            emoji: "⏰",
            children: [
              {
                id: id("n"),
                name: "크론 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-17", "크론 표현식 손에 익히기", "`*/5 * * * *` = 5분마다. 분/시/일/월/요일 순서 암기.", [], ["크론", "헤르메스"]),
                  entry("2026-06-01", "타임존 이슈 해결", "서버 UTC vs 로컬 KST 차이로 새벽 작업이 안 돈 원인 추적.", [
                    { type: "doc", name: "timezone-fix.md" }
                  ], ["크론", "트러블슈팅"])
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: id("n"),
    name: "개발",
    emoji: "🛠️",
    colorIndex: 2,
    children: [
      {
        id: id("n"),
        name: "프론트엔드",
        emoji: "🎨",
        children: [
          {
            id: id("n"),
            name: "CSS",
            emoji: "🎨",
            children: [
              {
                id: id("n"),
                name: "CSS 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-16", "CSS 컨테이너 쿼리", "부모 크기에 반응하는 레이아웃. 미디어쿼리보다 컴포넌트 친화적.", [
                    { type: "video", name: "강의 클립" }
                  ], ["프론트엔드", "CSS"]),
                  entry("2026-06-05", "뷰 트랜지션 API", "페이지 전환에 네이티브 애니메이션 적용해보기.", [
                    { type: "link", name: "MDN 문서 ↗", url: "#" }
                  ], ["프론트엔드", "CSS"])
                ]
              }
            ]
          }
        ]
      },
      {
        id: id("n"),
        name: "백엔드",
        emoji: "🔧",
        children: [
          {
            id: id("n"),
            name: "API",
            emoji: "🔌",
            children: [
              {
                id: id("n"),
                name: "API 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-10", "레이트리밋 미들웨어", "토큰버킷 알고리즘으로 API 호출 제한 구현.\n- 버킷 용량과 보충 속도 분리\n- 사용자별 키로 분리 카운트", [
                    { type: "doc", name: "rate-limit.ts" }
                  ], ["백엔드", "API"])
                ]
              }
            ]
          }
        ]
      },
      {
        id: id("n"),
        name: "데이터베이스",
        emoji: "🗄️",
        children: [
          {
            id: id("n"),
            name: "SQL",
            emoji: "🗃️",
            children: [
              {
                id: id("n"),
                name: "SQL 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-07", "인덱스 실행계획 읽기", "EXPLAIN ANALYZE 결과에서 시퀀셜 스캔 vs 인덱스 스캔 구분하기.", [
                    { type: "doc", name: "explain-notes.md" }
                  ], ["데이터베이스", "SQL"]),
                  entry("2026-05-26", "트랜잭션 격리수준", "Read Committed vs Repeatable Read 차이를 예제로 정리.", [], ["데이터베이스", "SQL"])
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: id("n"),
    name: "어학",
    emoji: "🌐",
    colorIndex: 3,
    children: [
      {
        id: id("n"),
        name: "영어",
        emoji: "🇺🇸",
        children: [
          {
            id: id("n"),
            name: "회화",
            emoji: "💬",
            children: [
              {
                id: id("n"),
                name: "회화 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-06-12", "스몰톡 표현 모음", "미팅 시작 전 가볍게 쓸 수 있는 표현 10개 정리.", [
                    { type: "video", name: "섀도잉 클립" }
                  ], ["영어", "회화"])
                ]
              }
            ]
          },
          {
            id: id("n"),
            name: "문법",
            emoji: "📖",
            children: [
              {
                id: id("n"),
                name: "문법 기록함",
                emoji: "📘",
                leaf: true,
                entries: [
                  entry("2026-05-31", "가정법 정리", "if절 시제별 가정법 표 만들고 예문 5개씩 작성.", [
                    { type: "doc", name: "grammar.pdf" }
                  ], ["영어", "문법"])
                ]
              }
            ]
          }
        ]
      },
      {
        id: id("n"),
        name: "일본어",
        emoji: "🇯🇵",
        children: [
          {
            id: id("n"),
            name: "한자",
            emoji: "🈂️",
            children: [
              { id: id("n"), name: "한자 기록함", emoji: "📘", leaf: true, entries: [] }
            ]
          }
        ]
      }
    ]
  }
];

function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StudyNode[]) : initialData();
  } catch {
    return initialData();
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } as Settings : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

const bootData = stripRecordBooks(loadData());

function findNode(nodes: StudyNode[], nodeId?: string): { node: StudyNode; parent?: StudyNode; list: StudyNode[] } | null {
  if (!nodeId) return null;
  for (const node of nodes) {
    if (node.id === nodeId) return { node, list: nodes };
    const found = findNode(node.children ?? [], nodeId);
    if (found) return { ...found, parent: node };
  }
  return null;
}

function pathTo(nodes: StudyNode[], nodeId?: string, trail: StudyNode[] = []): StudyNode[] {
  if (!nodeId) return [];
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === nodeId) return next;
    const child = pathTo(node.children ?? [], nodeId, next);
    if (child.length) return child;
  }
  return [];
}

function countEntries(node: StudyNode): number {
  return (node.entries?.length ?? 0) + (node.children ?? []).reduce((sum, child) => sum + countEntries(child), 0);
}

function countLeaves(node: StudyNode): { done: number; total: number } {
  if (!hasChildren(node)) return { done: node.entries?.length ? 1 : 0, total: 1 };
  return (node.children ?? []).reduce(
    (acc, child) => {
      const next = countLeaves(child);
      return { done: acc.done + next.done, total: acc.total + next.total };
    },
    { done: 0, total: 0 }
  );
}

function depthOf(nodes: StudyNode[], nodeId?: string, depth = 1): number {
  if (!nodeId) return 0;
  for (const node of nodes) {
    if (node.id === nodeId) return depth;
    const child = depthOf(node.children ?? [], nodeId, depth + 1);
    if (child) return child;
  }
  return 0;
}

// node 를 base 깊이에 두었을 때, 그 하위 트리에서 가장 깊은 카테고리의 깊이를 구한다.
// 기록(entry)은 노드를 만들지 않으므로 깊이에 영향을 주지 않는다.
function maxCategoryDepth(node: StudyNode, base: number): number {
  let max = base;
  for (const child of node.children ?? []) {
    max = Math.max(max, maxCategoryDepth(child, base + 1));
  }
  return max;
}

// 기록을 담는 "끝 노드"(하위 카테고리가 없는 노드) 목록.
function allLeaves(nodes: StudyNode[]): StudyNode[] {
  return nodes.flatMap((node) => hasChildren(node) ? allLeaves(node.children ?? []) : [node]);
}

function allEntries(nodes: StudyNode[]): { node: StudyNode; entry: StudyEntry }[] {
  return nodes.flatMap((node) => [
    ...(node.entries ?? []).map((entry) => ({ node, entry })),
    ...allEntries(node.children ?? []),
  ]);
}

function entriesForNode(node: StudyNode): { node: StudyNode; entry: StudyEntry }[] {
  return [
    ...(node.entries ?? []).map((entry) => ({ node, entry })),
    ...(node.children ?? []).flatMap(entriesForNode),
  ];
}

function folderInsights(node: StudyNode) {
  const leaves = hasChildren(node) ? allLeaves(node.children ?? []) : [node];
  const entries = entriesForNode(node);
  const latest = [...entries].sort((a, b) => b.entry.date.localeCompare(a.entry.date))[0];
  const emptyLeaves = leaves.filter((leaf) => !leaf.entries?.length);
  const staleLeaf = [...leaves]
    .filter((leaf) => leaf.entries?.length)
    .sort((a, b) => (a.entries?.[0]?.date ?? "").localeCompare(b.entries?.[0]?.date ?? ""))[0];
  const focusLeaf = emptyLeaves[0] ?? staleLeaf ?? leaves[0];
  const latestLeaf = latest?.node;
  return {
    focus: focusLeaf?.name ?? "새 기록",
    pausedAt: latestLeaf ? `${latestLeaf.name} · ${relDay(latest.entry.date)}` : "아직 없음",
    empty: emptyLeaves[0] ? `${emptyLeaves[0].name}${emptyLeaves.length > 1 ? ` 외 ${emptyLeaves.length - 1}` : ""}` : "모두 채움",
    nextLine: focusLeaf ? `${focusLeaf.name} 한 줄` : "오늘 한 줄"
  };
}

function colorIndexFor(nodes: StudyNode[], nodeId?: string): number {
  const path = pathTo(nodes, nodeId);
  return path[0]?.colorIndex ?? 0;
}

function relDay(date: string) {
  const target = new Date(`${date}T00:00`);
  const today = new Date(`${todayISO()}T00:00`);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  if (diff < 30) return `${Math.floor(diff / 7)}주 전`;
  return `${Math.floor(diff / 30)}개월 전`;
}

function fmt(date: string) {
  const d = new Date(`${date}T00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
}

function cloneUpdate(nodes: StudyNode[], updater: (draft: StudyNode[]) => void) {
  const draft = structuredClone(nodes) as StudyNode[];
  updater(draft);
  return draft;
}

function exportNoteToMd(folderPath: string, entry: StudyEntry) {
  const yaml = [
    '---',
    `title: "${entry.title.replace(/"/g, '\\"')}"`,
    `date: "${entry.date}"`,
    `folder: "${folderPath}"`,
    `tags: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');
  const content = yaml + entry.body;
  const safe = entry.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'note';
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function App() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const serverData = useQuery(api.nodes.get);
  const saveNodesMutation = useMutation(api.nodes.save);
  const lastSavedRef = useRef<string>("");

  const [nodes, setNodes] = useState<StudyNode[]>(bootData);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => allLeaves(bootData)[0]?.id);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"tree" | "stats" | "profile" | "graph">("tree");
  const [modal, setModal] = useState<ModalState>(null);
  const [draftEmoji, setDraftEmoji] = useState("📁");
  const [toast, setToast] = useState("오늘도 한 줄 기록해볼까? ✏️");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("auto");
  const [mobileRoute, setMobileRoute] = useState<MobileRoute>("home");
  const [openMenuId, setOpenMenuId] = useState<string | undefined>();
  const [dragId, setDragId] = useState<string | undefined>();
  const [dropInfo, setDropInfo] = useState<{ id: string; position: "before" | "after" | "inside" } | undefined>();
  const dragRef = useRef<{ dragId?: string; dropInfo?: { id: string; position: "before" | "after" | "inside" } }>({});
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  function onSidebarResizeStart(e: React.MouseEvent) {
    if (navCollapsed) return;
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: settings.sidebarWidth };
    document.body.classList.add("sb-resizing");

    const onMove: EventListener = (ev) => {
      if (!resizeRef.current) return;
      const clientX = (ev as globalThis.MouseEvent).clientX;
      const delta = clientX - resizeRef.current.startX;
      const w = Math.max(200, Math.min(600, resizeRef.current.startW + delta));
      document.documentElement.style.setProperty("--sb-w", `${w}px`);
    };

    const onUp: EventListener = (ev) => {
      if (!resizeRef.current) return;
      const clientX = (ev as globalThis.MouseEvent).clientX;
      const delta = clientX - resizeRef.current.startX;
      const w = Math.max(200, Math.min(600, resizeRef.current.startW + delta));
      resizeRef.current = null;
      document.body.classList.remove("sb-resizing");
      setSettings((s) => ({ ...s, sidebarWidth: Math.round(w) }));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Convex → local: 다른 기기에서 변경된 데이터를 실시간으로 반영
  useEffect(() => {
    if (!isAuthenticated || serverData === undefined) return;
    // 서버에 저장된 데이터가 아직 없으면(첫 동기화) 현재 로컬 데이터를 그대로 유지한다.
    // 이때 lastSavedRef를 건드리면 아래 "local → Convex" 효과가 업로드를 스킵해서
    // 로컬 데이터가 서버로 영영 올라가지 않는 버그가 생긴다. (그래서 여기서 그냥 빠진다)
    if (serverData === null) return;
    if (serverData === lastSavedRef.current) return;
    lastSavedRef.current = serverData;
    setNodes(stripRecordBooks(JSON.parse(serverData) as StudyNode[]));
  }, [serverData, isAuthenticated]);

  // local → Convex: 변경사항을 즉시 저장
  useEffect(() => {
    const json = JSON.stringify(nodes);
    localStorage.setItem(STORE_KEY, json);
    if (!isAuthenticated || json === lastSavedRef.current) return;
    lastSavedRef.current = json;
    saveNodesMutation({ data: json }).catch(() => {});
  }, [nodes, isAuthenticated]);

  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = settings.skin;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--sb-w", `${settings.sidebarWidth}px`);
    root.style.setProperty("--nav-font-size", `${settings.navSize}px`);
    root.style.setProperty("--body-font-size", `${settings.bodySize}px`);
    root.style.setProperty("--title-font-size", `${settings.titleSize}px`);
    root.dataset.font = settings.font;
  }, [settings]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".node-menu")) return;
      setOpenMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(undefined);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const selected = findNode(nodes, selectedId)?.node;
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tagQ = q.startsWith("#") ? q.slice(1) : null;
    return allEntries(nodes).filter(({ entry }) => {
      const textHit = entry.title.toLowerCase().includes(q) || entry.body.toLowerCase().includes(q);
      const tagHit = (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(tagQ ?? q));
      return textHit || tagHit;
    });
  }, [nodes, query]);

  function say(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function updateNode(nodeId: string, updater: (node: StudyNode) => void) {
    setNodes((prev) => cloneUpdate(prev, (draft) => {
      const found = findNode(draft, nodeId);
      if (found) updater(found.node);
    }));
  }

  function toggleNode(nodeId: string) {
    updateNode(nodeId, (node) => { node.open = !node.open; });
  }

  function setAllOpen(open: boolean) {
    setNodes((prev) => {
      const clone = structuredClone(prev) as StudyNode[];
      const walk = (list: StudyNode[]) => {
        for (const n of list) {
          if (hasChildren(n)) {
            n.open = open;
            walk(n.children!);
          }
        }
      };
      walk(clone);
      return clone;
    });
  }

  function renameNode(nodeId: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;
    updateNode(nodeId, (node) => { node.name = nextName; });
    say("이름을 바꿨어요 ✏️");
  }

  // 하위 분류나 기록이 들어 있으면 바로 지우지 않고 먼저 확인을 받는다.
  function deleteNode(nodeId: string) {
    const node = findNode(nodes, nodeId)?.node;
    if (!node) return;
    const hasContent = hasChildren(node) || countEntries(node) > 0;
    if (hasContent) {
      setModal({ kind: "confirmDelete", nodeId });
      return;
    }
    performDeleteNode(nodeId);
  }

  function performDeleteNode(nodeId: string) {
    setNodes((prev) => cloneUpdate(prev, (draft) => {
      const found = findNode(draft, nodeId);
      if (!found) return;
      found.list.splice(found.list.findIndex((item) => item.id === nodeId), 1);
    }));
    if (selectedId === nodeId) setSelectedId(allLeaves(nodes).find((leaf) => leaf.id !== nodeId)?.id);
    setModal(null);
    say("정리했어요 🧹");
  }

  function saveCategory(parentId: string | undefined, name: string, leaf: boolean, emoji: string, initialEntry?: StudyEntry) {
    const nextName = name.trim();
    if (!nextName) return;
    const newId = id("n");
    // 모든 새 노드는 카테고리다. 하위가 없으면 그 자체가 기록을 담는 끝 노드가 된다.
    const node: StudyNode = { id: newId, name: nextName, emoji, children: [], entries: initialEntry ? [initialEntry] : [] };
    setNodes((prev) => cloneUpdate(prev, (draft) => {
      if (!parentId) {
        node.colorIndex = draft.length % palette.length;
        draft.push(node);
        return;
      }
      const parent = findNode(draft, parentId)?.node;
      if (!parent) return;
      parent.children = parent.children ?? [];
      parent.children.push(node);
      parent.open = true;
    }));
    setModal(null);
    setTimeout(() => {
      const el = document.querySelector(`[data-nodeid="${newId}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2);
      }
    }, 60);
    say("새 폴더 추가! 📁");
  }

  function saveEntry(nodeId: string, saved: StudyEntry) {
    setNodes((prev) => cloneUpdate(prev, (draft) => {
      const node = findNode(draft, nodeId)?.node;
      if (!node) return;
      node.entries = node.entries ?? [];
      const idx = node.entries.findIndex((item) => item.id === saved.id);
      if (idx >= 0) node.entries[idx] = saved;
      else node.entries.unshift(saved);
    }));
    setModal(null);
    setSelectedId(nodeId);
    const main = document.querySelector(".main");
    if (main) {
      const r = main.getBoundingClientRect();
      burst(r.left + r.width / 2, 160);
    }
    say("노트 저장! ✨");
  }

  function deleteEntry(nodeId: string, entryId: string) {
    updateNode(nodeId, (node) => {
      node.entries = (node.entries ?? []).filter((entry) => entry.id !== entryId);
    });
    setModal(null);
    say("노트를 지웠어요 🧹");
  }

  function moveNode(dropX: number, dropY: number) {
    const { dragId: dId, dropInfo: dInfo } = dragRef.current;
    if (!dId || !dInfo || dId === dInfo.id) return;
    const { id: targetId, position } = dInfo;

    // 깊이 제한 검사: 폴더는 MAX_DEPTH 보다 깊은 위치에 둘 수 없다.
    const dragging = findNode(nodes, dId)?.node;
    const targetDepth = depthOf(nodes, targetId);
    if (dragging && targetDepth) {
      const newDepth = position === "inside" ? targetDepth + 1 : targetDepth;
      if (maxCategoryDepth(dragging, newDepth) > MAX_DEPTH) {
        dragRef.current = {};
        setDragId(undefined);
        setDropInfo(undefined);
        say(`폴더는 최대 ${MAX_DEPTH}단계까지만 둘 수 있어요 📏`);
        return;
      }
    }

    setNodes((prev) => cloneUpdate(prev, (draft) => {
      const dragResult = findNode(draft, dId);
      if (!dragResult) return;
      const dragNode = dragResult.node;
      const dragIdx = dragResult.list.findIndex((n) => n.id === dId);
      dragResult.list.splice(dragIdx, 1);
      const targetResult = findNode(draft, targetId);
      if (!targetResult) return;
      if (position === "inside") {
        targetResult.node.children = targetResult.node.children ?? [];
        targetResult.node.children.push(dragNode);
        targetResult.node.open = true;
      } else {
        const targetIdx = targetResult.list.findIndex((n) => n.id === targetId);
        targetResult.list.splice(position === "before" ? targetIdx : targetIdx + 1, 0, dragNode);
      }
    }));
    dragRef.current = {};
    setDragId(undefined);
    setDropInfo(undefined);
    burst(dropX, dropY);
    say("이동 완료! 📂");
  }

  function openAddFor(parentId?: string) {
    setDraftEmoji("📁");
    setModal({ kind: "category", parentId, leaf: false });
  }

  const appClass = `app-shell ${navCollapsed ? "nav-collapsed" : ""} ${previewMode === "mobile" ? "preview-mobile" : ""}`;

  if (authLoading) return <SplashScreen />;
  if (!isAuthenticated) return <LoginPage />;

  return (
    <div className={appClass}>
      <TopBar
        query={query}
        setQuery={setQuery}
        onSignOut={() => signOut()}
        openSettings={() => setModal({ kind: "settings" })}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
      />

      <aside className="sidebar">
        <div className="sidebar-resizer" onMouseDown={onSidebarResizeStart} />
        <div className="side-head">
          <h2>Study Map</h2>
          {!navCollapsed && (
            <div className="tree-actions">
              <button className="tree-act-btn" title="전체 펼치기" onClick={() => setAllOpen(true)}>⊞</button>
              <button className="tree-act-btn" title="전체 접기" onClick={() => setAllOpen(false)}>⊟</button>
            </div>
          )}
        </div>
        {!navCollapsed && (
          <div className="sidebar-view-tabs">
            <button className={`svt${view === "tree" ? " active" : ""}`} onClick={() => setView("tree")} title="트리 뷰">🌳</button>
            <button className={`svt${view === "graph" ? " active" : ""}`} onClick={() => setView("graph")} title="그래프 뷰">🕸️</button>
            <button className={`svt${view === "stats" ? " active" : ""}`} onClick={() => setView("stats")} title="통계">📊</button>
            <button className={`svt${view === "profile" ? " active" : ""}`} onClick={() => setView("profile")} title="연동">🔗</button>
          </div>
        )}
        <button
          className="nav-toggle"
          onClick={() => setNavCollapsed((v) => !v)}
          title={navCollapsed ? "네비게이션 펼치기" : "네비게이션 접기"}
        >
          {navCollapsed ? "›" : "‹"}
        </button>
        <nav
          className="tree"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedId(undefined);
          }}
        >
          {nodes.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              nodes={nodes}
              selectedId={selectedId}
              onSelect={(node) => {
                setView("tree");
                setSelectedId(node.id);
                if (hasChildren(node)) updateNode(node.id, (item) => { item.open = true; });
              }}
              onToggle={toggleNode}
              onRename={renameNode}
              onDelete={deleteNode}
              onAdd={openAddFor}
              onAddEntry={(nodeId) => setModal({ kind: "entry", nodeId })}
              onEmoji={(nodeId) => setModal({ kind: "emoji", nodeId })}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              dragId={dragId}
              dropInfo={dropInfo}
              onDragStart={(nodeId) => { dragRef.current.dragId = nodeId; setDragId(nodeId); }}
              onDragEnd={() => { dragRef.current = {}; setDragId(undefined); setDropInfo(undefined); }}
              onDragOver={(nodeId, position) => { dragRef.current.dropInfo = { id: nodeId, position }; setDropInfo({ id: nodeId, position }); }}
              onDrop={(x, y) => moveNode(x, y)}
              maxDepth={MAX_DEPTH}
            />
          ))}
          <NavAddButton
            selected={selected}
            nodes={nodes}
            onAddRoot={() => openAddFor()}
            onAddChild={(nodeId) => openAddFor(nodeId)}
            onAddEntry={(nodeId) => setModal({ kind: "entry", nodeId })}
          />
        </nav>
      </aside>

      <main className="main">
        {query ? (
          <SearchView
            query={query}
            results={searchResults}
            nodes={nodes}
            onOpen={(nodeId) => {
              setQuery("");
              setView("tree");
              setSelectedId(nodeId);
            }}
          />
        ) : view === "stats" ? (
          <StatsView nodes={nodes} searchTag={(tag) => setQuery(`#${tag}`)} />
        ) : view === "profile" ? (
          <ProfileView />
        ) : view === "graph" ? (
          <GraphView nodes={nodes} onNavigate={(nodeId) => { setView("tree"); setSelectedId(nodeId); }} />
        ) : selected ? (
          <DetailView
            node={selected}
            nodes={nodes}
            maxDepth={MAX_DEPTH}
            onSelect={setSelectedId}
            onAdd={openAddFor}
            onAddEntry={(nodeId) => setModal({ kind: "entry", nodeId })}
            onEditEntry={(nodeId, entryId) => setModal({ kind: "entry", nodeId, entryId })}
            onEmoji={(nodeId) => setModal({ kind: "emoji", nodeId })}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      <MobileShell
        nodes={nodes}
        selectedId={selectedId}
        route={mobileRoute}
        previewMode={previewMode}
        query={query}
        toast={toast}
        searchResults={searchResults}
        setQuery={setQuery}
        setRoute={setMobileRoute}
        setPreviewMode={setPreviewMode}
        onSelect={(nodeId) => setSelectedId(nodeId)}
        onToggle={toggleNode}
        onRename={renameNode}
        onEmoji={(nodeId, emoji) => updateNode(nodeId, (node) => { node.emoji = emoji; })}
        onAdd={openAddFor}
        onAddEntry={(nodeId) => setModal({ kind: "entry", nodeId })}
        onEditEntry={(nodeId, entryId) => setModal({ kind: "entry", nodeId, entryId })}
        onSaveEntry={saveEntry}
        onDeleteEntry={deleteEntry}
        onSaveCategory={saveCategory}
        onDeleteNode={deleteNode}
        say={say}
        searchTag={(tag) => setQuery(`#${tag}`)}
        maxDepth={MAX_DEPTH}
      />

      <div id="burst-fx" className="fx" />
      <Mascot message={toast} onClick={(e) => { burst(e.clientX, e.clientY); say(["화이팅! 💪", "좋아좋아! 🎈", "오늘도 한 칸 채워봐요 ✏️"][Math.floor(Math.random() * 3)]); }} />

      {modal?.kind === "entry" && (
        <EntryModal
          node={findNode(nodes, modal.nodeId)?.node}
          entryId={modal.entryId}
          onClose={() => setModal(null)}
          onSave={saveEntry}
          onDelete={deleteEntry}
          nodePath={pathTo(nodes, modal.nodeId).map((n) => n.name).join(" › ")}
          obsidianVault={settings.obsidianVault}
          allNodes={nodes}
          onWikiLink={(titleTarget) => {
            const found = allEntries(nodes).find(e => e.entry.title === titleTarget);
            if (found) { setModal(null); setSelectedId(found.node.id); }
          }}
        />
      )}
      {modal?.kind === "category" && (
        <CategoryModal
          leaf={modal.leaf}
          emoji={draftEmoji}
          parentName={modal.parentId ? findNode(nodes, modal.parentId)?.node.name : undefined}
          onEmojiPick={setDraftEmoji}
          onClose={() => setModal(null)}
          onSave={(name, initialEntry) => saveCategory(modal.parentId, name, modal.leaf, draftEmoji, initialEntry)}
        />
      )}
      {modal?.kind === "emoji" && (
        <EmojiPicker
          onPick={(emoji) => {
            if (modal.draftTarget === "category") {
              setDraftEmoji(emoji);
              setModal({ kind: "category", leaf: false });
            } else if (modal.nodeId) {
              updateNode(modal.nodeId, (node) => { node.emoji = emoji; });
              setModal(null);
              say(`이모지 변경 완료! ${emoji}`);
            }
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "settings" && (
        <SettingsPanel
          settings={settings}
          setSettings={setSettings}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "confirmDelete" && (
        <ConfirmDeleteModal
          node={findNode(nodes, modal.nodeId)?.node}
          onClose={() => setModal(null)}
          onConfirm={() => performDeleteNode(modal.nodeId)}
        />
      )}
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="splash">
      <div className="splash-logo">📖</div>
      <p>로딩 중…</p>
    </div>
  );
}

function LoginPage() {
  const { signIn } = useAuthActions();
  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">📖</div>
        <h1>몽글 Study</h1>
        <p>소셜 계정으로 로그인하면<br />모든 기기에서 실시간 동기화됩니다</p>
        <div className="login-btns">
          <button className="login-btn google" onClick={() => signIn("google", { redirectTo: "/" })}>
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Google로 계속하기
          </button>
          <button className="login-btn github" onClick={() => signIn("github", { redirectTo: "/" })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub로 계속하기
          </button>
          <button className="login-btn kakao" onClick={() => signIn("kakao", { redirectTo: "/" })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.747 1.657 5.164 4.147 6.568l-1.054 3.946a.3.3 0 0 0 .437.338l4.63-3.082A11.867 11.867 0 0 0 12 18.6c5.523 0 10-3.477 10-7.8S17.523 3 12 3z"/></svg>
            카카오로 계속하기
          </button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ query, setQuery, openSettings, onSignOut, previewMode, setPreviewMode }: {
  query: string;
  setQuery: (value: string) => void;
  openSettings: () => void;
  onSignOut: () => void;
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <MochiLogo />
        <span>몽글</span>
        <small>Study</small>
      </div>
      <div className="search">
        <span>⌕</span>
        <input id="global-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·내용·태그 검색… (#태그)" />
        {query && <button onClick={() => setQuery("")}>×</button>}
      </div>
      <button
        className={`streak dev-preview ${previewMode === "mobile" ? "active" : ""}`}
        onClick={() => setPreviewMode(previewMode === "mobile" ? "auto" : "mobile")}
      >
        {previewMode === "mobile" ? "↔ 자동 보기" : "📱 모바일 미리보기"}
      </button>
      <button className="streak soft" onClick={openSettings}>⚙️ 설정</button>
      <button className="streak soft" onClick={onSignOut} title="로그아웃">↩ 로그아웃</button>
      <div className="streak">🔥 7일</div>
    </header>
  );
}

function NavAddButton({ selected, nodes, onAddRoot, onAddChild, onAddEntry }: {
  selected?: StudyNode;
  nodes: StudyNode[];
  onAddRoot: () => void;
  onAddChild: (nodeId: string) => void;
  onAddEntry: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const folderAllowed = selected ? canAddCategory(depthOf(nodes, selected.id)) : false;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // 선택이 없으면 대분류(루트 폴더) 추가, 있으면 분류/기록 선택 팝업.
  if (!selected) {
    return (
      <button className="nav-add-button" aria-label="대분류 추가" title="대분류 추가"
        onClick={(e) => { e.stopPropagation(); onAddRoot(); }}>
        <span>＋</span>
      </button>
    );
  }
  return (
    <div className="nav-add-wrap">
      {open && (
        <div className="node-menu nav-add-menu" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {folderAllowed && <button onClick={() => { onAddChild(selected.id); setOpen(false); }}>📁 폴더 추가</button>}
          <button onClick={() => { onAddEntry(selected.id); setOpen(false); }}>📝 노트 추가</button>
        </div>
      )}
      <button className="nav-add-button" aria-label="추가" title="폴더 또는 노트 추가"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <span>＋</span>
      </button>
    </div>
  );
}

function TreeNode(props: {
  node: StudyNode;
  nodes: StudyNode[];
  selectedId?: string;
  openMenuId?: string;
  dragId?: string;
  dropInfo?: { id: string; position: "before" | "after" | "inside" };
  maxDepth: number;
  onSelect: (node: StudyNode) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: (id?: string) => void;
  onAddEntry: (id: string) => void;
  onEmoji: (id: string) => void;
  setOpenMenuId: (id?: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (id: string, position: "before" | "after" | "inside") => void;
  onDrop: (x: number, y: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { node, nodes, maxDepth } = props;
  const [dot, soft] = palette[colorIndexFor(nodes, node.id) % palette.length];
  const selected = props.selectedId === node.id;
  const hasKids = Boolean(node.children?.length);
  // 하위 폴더와 직접 기록이 섞여 있는 노드는 이름 옆에 직접 기록 개수를 작게 표시한다.
  const ownEntries = node.entries?.length ?? 0;
  const showMixCount = hasKids && ownEntries > 0;
  const menu = props.openMenuId === node.id;
  const openMenu = () => props.setOpenMenuId(node.id);
  const closeMenu = () => props.setOpenMenuId(undefined);
  const openEmojiPicker = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    props.onEmoji(node.id);
  };
  const dropPos = props.dropInfo?.id === node.id ? props.dropInfo.position : undefined;
  const isDragging = props.dragId === node.id;

  return (
    <div className={`node ${node.open ? "open" : ""} ${isDragging ? "dragging" : ""}`} data-nodeid={node.id}>
      <div
        className={`row ${selected ? "sel" : ""} ${dropPos ? `drop-${dropPos}` : ""}`}
        draggable
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; props.onDragStart(node.id); }}
        onDragEnd={() => props.onDragEnd()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientY - rect.top) / rect.height;
          const canNest = !(node.entries?.length);
          const position = pct < 0.3 ? "before" : pct > 0.7 ? "after" : canNest ? "inside" : (pct < 0.5 ? "before" : "after");
          props.onDragOver(node.id, position);
        }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); props.onDrop(e.clientX, e.clientY); }}
        onClick={() => props.onSelect(node)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          setEditing(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu();
        }}
        data-name={node.name}
      >
        <span className="drag-handle">⠿</span>
        <button className={`twist ${hasKids ? "" : "leaf"}`} onClick={(e) => { e.stopPropagation(); props.onToggle(node.id); }}>›</button>
        <button
          className="emoji"
          title="더블클릭으로 이모지 변경"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClickCapture={openEmojiPicker}
          onDoubleClick={openEmojiPicker}
        >
          {node.emoji}
        </button>
        {editing ? (
          <input
            className="inline-rename"
            autoFocus
            defaultValue={node.name}
            onBlur={(e) => { props.onRename(node.id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="name">{node.name}</span>
        )}
        {!editing && showMixCount && (
          <span className="mix-count" title={`이 폴더의 기록 ${ownEntries}개`}>+{ownEntries}</span>
        )}
      </div>
      {menu && (
        <div className="node-menu" style={{ borderColor: soft }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {canAddCategory(depthOf(nodes, node.id)) && <button onClick={() => { props.onAdd(node.id); closeMenu(); }}>＋ 폴더 추가</button>}
          <button onClick={() => { props.onAddEntry(node.id); closeMenu(); }}>📝 노트 추가</button>
          <button className="danger" onClick={() => { props.onDelete(node.id); closeMenu(); }}>🗑️ 삭제</button>
        </div>
      )}
      {hasKids && node.open && (
        <div className="kids">
          {node.children!.map((child) => <TreeNode key={child.id} {...props} node={child} />)}
        </div>
      )}

    </div>
  );
}

function DetailView({ node, nodes, onSelect, onAdd, onAddEntry, onEditEntry, onEmoji }: {
  node: StudyNode;
  nodes: StudyNode[];
  maxDepth: number;
  onSelect: (id: string) => void;
  onAdd: (id?: string) => void;
  onAddEntry: (id: string) => void;
  onEditEntry: (nodeId: string, entryId: string) => void;
  onEmoji: (id: string) => void;
}) {
  const [dot, soft] = palette[colorIndexFor(nodes, node.id) % palette.length];
  const crumbs = pathTo(nodes, node.id);
  const depth = depthOf(nodes, node.id);
  const folderAllowed = canAddCategory(depth);

  const children = node.children ?? [];
  const entries = [...(node.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const grouped = entries.reduce<Record<string, StudyEntry[]>>((acc, entry) => {
    acc[entry.date] = acc[entry.date] ?? [];
    acc[entry.date].push(entry);
    return acc;
  }, {});
  const latest = entries[0];

  return (
    <>
      <PageHead
        crumbs={crumbs}
        emoji={node.emoji}
        soft={soft}
        title={node.name}
        subtitle="폴더와 노트를 한 곳에서"
        onEmoji={() => onEmoji(node.id)}
        action={
          <>
            {folderAllowed && <button className="btn" onClick={() => onAdd(node.id)}>＋ 폴더 추가</button>}
            <button className="btn btn-primary" onClick={() => onAddEntry(node.id)}>＋ 노트 추가</button>
          </>
        }
      />
      <div className="stats">
        <Stat label="📁 하위 폴더" value={children.length} suffix="개" color={dot} compact />
        <Stat label="📝 노트" value={entries.length} suffix="개" color="var(--mint)" compact />
        <Stat label="⏱ 최근 노트" value={latest ? `${relDay(latest.date)} · ${latest.title}` : "아직 없음"} color="var(--peach)" compact />
        <Stat label="✏️ 다음 한 줄" value={latest ? "오늘 배운 것" : "첫 노트 남기기"} color="var(--sky)" compact />
      </div>

      {children.length > 0 && (
        <>
          <h2 className="section-title">하위 폴더</h2>
          <div className="grid-cards">
            {children.map((child) => {
              const [cdot, csoft] = palette[colorIndexFor(nodes, child.id) % palette.length];
              const childLeaves = countLeaves(child);
              const childPct = childLeaves.total ? Math.round((childLeaves.done / childLeaves.total) * 100) : 0;
              const childKids = child.children?.length ?? 0;
              return (
                <button className="cat-card" key={child.id} onClick={() => onSelect(child.id)}>
                  <div className="top">
                    <div className="ic" style={{ background: csoft }}>{child.emoji}</div>
                    <div><h4>{child.name}</h4><span>{childKids > 0 ? `${childKids}개 폴더 · ` : ""}{countEntries(child)}개 노트</span></div>
                  </div>
                  <div className="ring-row">
                    <div className="ring" style={{ "--p": childPct, "--rc": cdot } as CSSProperties}><b>{childPct}%</b></div>
                    <div className="meta"><b>{countEntries(child)}</b>개 노트<br />열어보기</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {entries.length > 0 && (
        <>
          <h2 className="section-title">노트</h2>
          <div className="timeline">
            {Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map((date) => (
              <section className="day" key={date}>
                <div className="day-label"><span className="date">{fmt(date)}</span><span className="rel">{relDay(date)}</span><span className="line" /></div>
                {grouped[date].map((entry) => (
                  <EntryCard key={entry.id} entry={entry} onEdit={() => onEditEntry(node.id, entry.id)} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {children.length === 0 && entries.length === 0 && (
        <EmptyState
          title="비어있어요"
          body={folderAllowed ? "’＋ 폴더 추가’로 폴더를, ‘＋ 노트 추가’로 노트를 남겨보세요" : "’＋ 노트 추가’로 노트를 남겨보세요"}
          emoji="📂"
        />
      )}

      {(() => {
        const myTitles = new Set(entries.map(e => e.title));
        const backlinks = allEntries(nodes).filter(({ node: n, entry: e }) => {
          if (n.id === node.id) return false;
          for (const m of e.body.matchAll(/\[\[(.+?)\]\]/g)) { if (myTitles.has(m[1])) return true; }
          return false;
        });
        if (!backlinks.length) return null;
        return (
          <div className="backlinks-section">
            <h2 className="section-title">🔗 이 폴더를 언급한 노트 ({backlinks.length})</h2>
            <div className="backlinks-list">
              {backlinks.map(({ node: n, entry: e }) => (
                <button key={e.id} type="button" className="backlink-item" onClick={() => onSelect(n.id)}>
                  <span className="backlink-folder">{n.emoji} {n.name}</span>
                  <span className="backlink-title">{e.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}

function PageHead({ crumbs, emoji, soft, title, subtitle, action, onEmoji }: {
  crumbs: StudyNode[];
  emoji: string;
  soft: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  onEmoji: () => void;
}) {
  return (
    <>
      <div className="crumbs">
        {crumbs.map((crumb, index) => (
          <span key={crumb.id}>{index ? <span className="sep">›</span> : null}{index === crumbs.length - 1 ? <b>{crumb.name}</b> : crumb.name}</span>
        ))}
      </div>
      <div className="page-head">
        <div className="page-title">
          <button className="badge" style={{ background: soft }} onClick={onEmoji}>{emoji}</button>
          <div><h1>{title}</h1><p>{subtitle}</p></div>
        </div>
        {action}
      </div>
    </>
  );
}

function Stat({ label, value, suffix, color, compact }: { label: string; value: string | number; suffix?: string; color: string; compact?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className={`v ${compact ? "compact" : ""}`}>{value}<small>{suffix}</small></div>
      <div className="blob" style={{ background: color }} />
    </div>
  );
}

function EntryCard({ entry, onEdit }: { entry: StudyEntry; onEdit: () => void }) {
  const icon = { doc: "📄", video: "🎬", link: "🔗" } satisfies Record<AttachmentType, string>;
  return (
    <article className="entry" onDoubleClick={onEdit} onClick={(e) => {
      if (window.matchMedia("(max-width: 760px)").matches) onEdit();
      e.currentTarget.classList.add("pulse");
      window.setTimeout(() => e.currentTarget.classList.remove("pulse"), 300);
    }}>
      <h3><span className="tick">✓</span>{entry.title}</h3>
      <p className="body body-summary">
        {entry.body.replace(/^[-*]\s*/gm, "").replace(/\n+/g, " ").trim() || "내용 없음"}
      </p>
      {entry.attachments.length ? (
        <div className="attach">
          {entry.attachments.map((attachment) => <span className={`chip ${attachment.type}`} key={attachment.id}>{icon[attachment.type]} {attachment.name}</span>)}
        </div>
      ) : null}
      {entry.tags.length ? (
        <div className="tags-row">{entry.tags.map((tag) => <span className="tag-pill" key={tag}>#{tag}</span>)}</div>
      ) : null}
    </article>
  );
}

function SearchView({ query, results, nodes, onOpen }: {
  query: string;
  results: { node: StudyNode; entry: StudyEntry }[];
  nodes: StudyNode[];
  onOpen: (nodeId: string) => void;
}) {
  return (
    <>
      <PageHead crumbs={[]} emoji="🔍" soft="var(--accent-soft)" title="검색 결과" subtitle={`'${query}' · ${results.length}개 노트 매칭`} onEmoji={() => {}} />
      <div className="search-results">
        {results.length ? results.map(({ node, entry }) => (
          <button className="search-hit" key={entry.id} onClick={() => onOpen(node.id)}>
            <span className="search-hit-path">{pathTo(nodes, node.id).map((n) => n.name).join(" › ")}</span>
            <b>{entry.title}</b>
            <span>{entry.body.replace(/^[-*]\s*/gm, "").replace(/\n+/g, " ").slice(0, 110)}</span>
            <small>{fmt(entry.date)} · {(entry.tags ?? []).map((tag) => `#${tag}`).join(" ")}</small>
          </button>
        )) : <EmptyState title="결과가 없어요" body="제목·내용·태그를 모두 검색해봤어요" emoji="🔍" />}
      </div>
    </>
  );
}

function StatsView({ nodes, searchTag }: { nodes: StudyNode[]; searchTag: (tag: string) => void }) {
  const entries = allEntries(nodes);
  const leaves = allLeaves(nodes);
  const tagCounts = entries.reduce<Record<string, number>>((acc, { entry }) => {
    entry.tags.forEach((tag) => { acc[tag] = (acc[tag] ?? 0) + 1; });
    return acc;
  }, {});
  const maxCat = Math.max(1, ...nodes.map(countEntries));
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const iso = date.toISOString().slice(0, 10);
    return { iso, count: entries.filter(({ entry }) => entry.date === iso).length };
  });
  const maxDay = Math.max(1, ...days.map((day) => day.count));

  return (
    <>
      <PageHead crumbs={[]} emoji="📊" soft="var(--accent-soft)" title="학습 통계" subtitle="카테고리·태그·기록 추이를 한눈에" onEmoji={() => {}} />
      <div className="stats">
        <Stat label="📚 노트 칸" value={leaves.length} suffix="개" color="var(--accent)" />
        <Stat label="📝 전체 노트" value={entries.length} suffix="개" color="var(--mint)" />
        <Stat label="🏷️ 사용중인 태그" value={Object.keys(tagCounts).length} suffix="개" color="var(--peach)" />
        <Stat label="🔥 연속 기록" value="7" suffix="일" color="var(--sky)" />
      </div>
      <h2 className="section-title">대분류별 노트 현황</h2>
      <div className="cat-bars">
        {nodes.map((node) => {
          const [dot] = palette[(node.colorIndex ?? 0) % palette.length];
          const count = countEntries(node);
          return (
            <div className="cat-bar-row" key={node.id}>
              <span>{node.emoji} <b>{node.name}</b></span>
              <div className="cbr-track"><div style={{ width: `${Math.round(count / maxCat * 100)}%`, background: dot }} /></div>
              <small>{count}개</small>
            </div>
          );
        })}
      </div>
      <h2 className="section-title">최근 14일 노트 추이</h2>
      <div className="day-bars">
        {days.map((day) => <div className="dbar" key={day.iso}><div style={{ height: day.count ? 12 + Math.round(day.count / maxDay * 56) : 4 }} /><span>{new Date(`${day.iso}T00:00`).getDate()}</span></div>)}
      </div>
      <h2 className="section-title">태그로 둘러보기</h2>
      <div className="tag-cloud">
        {Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => (
          <button className="tagchip" key={tag} onClick={() => searchTag(tag)}>#{tag} <span>{count}</span></button>
        ))}
      </div>
    </>
  );
}

function GraphView({ nodes: studyNodes, onNavigate }: { nodes: StudyNode[]; onNavigate: (nodeId: string) => void }) {
  const entries = useMemo(() => allEntries(studyNodes), [studyNodes]);

  const { gNodes, gEdges } = useMemo(() => {
    const W = 800, H = 520;
    const titleToInfo = new Map(entries.map(e => [e.entry.title, { id: e.entry.id, nodeId: e.node.id }]));
    const edgeSet = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    for (const { entry } of entries) {
      for (const m of entry.body.matchAll(/\[\[(.+?)\]\]/g)) {
        const t = titleToInfo.get(m[1]);
        if (t && t.id !== entry.id) {
          const key = [entry.id, t.id].sort().join('|');
          if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ from: entry.id, to: t.id }); }
        }
      }
    }
    const count = entries.length;
    const pos = entries.map((_, i) => ({
      x: W / 2 + Math.cos((i / count) * Math.PI * 2) * (Math.min(W, H) * 0.33),
      y: H / 2 + Math.sin((i / count) * Math.PI * 2) * (Math.min(W, H) * 0.33),
      vx: 0, vy: 0,
    }));
    const idxOf = new Map(entries.map((e, i) => [e.entry.id, i]));
    for (let iter = 0; iter < 90; iter++) {
      for (let a = 0; a < pos.length; a++) {
        for (let b = a + 1; b < pos.length; b++) {
          const dx = pos[b].x - pos[a].x || 0.1, dy = pos[b].y - pos[a].y || 0.1;
          const d = Math.sqrt(dx * dx + dy * dy) || 1, f = 1800 / (d * d);
          pos[a].vx -= dx / d * f; pos[a].vy -= dy / d * f;
          pos[b].vx += dx / d * f; pos[b].vy += dy / d * f;
        }
      }
      for (const e of edges) {
        const si = idxOf.get(e.from)!, ti = idxOf.get(e.to)!;
        if (si === undefined || ti === undefined) continue;
        const dx = pos[ti].x - pos[si].x, dy = pos[ti].y - pos[si].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 130) * 0.045;
        pos[si].vx += dx / d * f; pos[si].vy += dy / d * f;
        pos[ti].vx -= dx / d * f; pos[ti].vy -= dy / d * f;
      }
      for (const p of pos) {
        p.vx += (W / 2 - p.x) * 0.007; p.vy += (H / 2 - p.y) * 0.007;
        p.vx *= 0.88; p.vy *= 0.88;
        p.x = Math.max(50, Math.min(W - 50, p.x + p.vx));
        p.y = Math.max(50, Math.min(H - 50, p.y + p.vy));
      }
    }
    const gNodes = entries.map((e, i) => ({ id: e.entry.id, title: e.entry.title, nodeId: e.node.id, x: pos[i].x, y: pos[i].y }));
    return { gNodes, gEdges: edges };
  }, [entries]);

  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <>
      <PageHead crumbs={[]} emoji="🕸️" soft="var(--accent-soft)" title="노트 연결 그래프" subtitle={`${gNodes.length}개 노트 · ${gEdges.length}개 연결`} onEmoji={() => {}} />
      {gNodes.length === 0 ? (
        <div className="graph-empty">
          <p>아직 노트가 없습니다.</p>
          <p className="graph-empty-hint">노트 내용에 <code>{'[[다른 노트 제목]]'}</code>을 입력하면 연결이 생깁니다.</p>
        </div>
      ) : (
        <>
          <p className="graph-hint">노트 본문에서 <code>{'[[노트 제목]]'}</code>을 입력하거나 툴바의 🔗 버튼을 사용해 연결을 만드세요. 노드를 클릭하면 해당 폴더로 이동합니다.</p>
          <div className="graph-wrap">
            <svg className="graph-svg" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid meet">
              {gEdges.map((e, idx) => {
                const s = gNodes.find(n => n.id === e.from), t = gNodes.find(n => n.id === e.to);
                if (!s || !t) return null;
                const active = hovered === s.id || hovered === t.id;
                return <line key={idx} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={active ? "var(--accent)" : "var(--border-2)"} strokeWidth={active ? 2.5 : 1.5} opacity={active ? 1 : 0.5} />;
              })}
              {gNodes.map(n => {
                const linked = gEdges.some(e => e.from === n.id || e.to === n.id);
                const hot = hovered === n.id;
                return (
                  <g key={n.id} onClick={() => onNavigate(n.nodeId)} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
                    <circle cx={n.x} cy={n.y} r={hot ? 19 : 14} fill={linked ? "var(--accent-soft)" : "var(--surface-2)"} stroke={hot || linked ? "var(--accent)" : "var(--border)"} strokeWidth={hot ? 3 : 1.5} style={{ transition: 'r .12s, stroke-width .12s' }} />
                    <text x={n.x} y={n.y + (hot ? 30 : 26)} textAnchor="middle" fontSize={hot ? 11 : 10} fill="var(--fg)" fontWeight={hot ? 700 : 400} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {n.title.length > 11 ? n.title.slice(0, 11) + '…' : n.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </>
  );
}

function ProfileView() {
  return (
    <>
      <PageHead crumbs={[]} emoji="🔗" soft="var(--sky-soft)" title="연동 & 내보내기" subtitle="Obsidian, 마크다운 내보내기, 백엔드 연결" onEmoji={() => {}} />
      <h2 className="section-title">🟣 Obsidian 연동</h2>
      <div className="profile-grid">
        <InfoCard title="노트 → Obsidian으로 열기" value="obsidian:// URI 지원" body="노트 편집 모달 하단의 '🟣 Obsidian' 버튼을 누르면 현재 노트가 Obsidian의 새 노트로 즉시 열립니다. 설정에서 볼트 이름을 지정하면 해당 볼트로 바로 연결됩니다." />
        <InfoCard title=".md 내보내기" value="YAML Frontmatter 포함" body="노트 편집 모달의 '⬇ .md' 버튼으로 YAML 메타데이터(제목, 날짜, 태그, 폴더 경로)가 포함된 마크다운 파일을 다운로드할 수 있습니다. 파일을 Obsidian 볼트 폴더에 놓으면 바로 인식됩니다." />
        <InfoCard title="Obsidian → 앱으로 가져오기" value="Local REST API 플러그인 필요" body="Obsidian Community Plugin인 'Local REST API'(포트 27123)를 설치하면 앱에서 볼트를 읽어 올 수 있는 방향으로 확장 가능합니다. 현재는 .md 파일 수동 복사 방식을 권장합니다." />
      </div>
      <h2 className="section-title">💾 저장소 & 백엔드</h2>
      <div className="profile-grid">
        <InfoCard title="현재 저장소" value="Convex 실시간 동기화" body="로그인 후 모든 데이터가 Convex 서버에 실시간으로 동기화됩니다. 여러 기기에서 즉시 반영됩니다." />
        <InfoCard title="마크다운 에디터" value="노션 스타일 서식 지원" body="**굵게**, *기울임*, ~~취소선~~, # 제목, - 목록, - [ ] 체크박스, > 인용, --- 구분선, `코드`를 직접 입력하거나 툴바를 활용하세요. 미리보기 모드로 결과를 확인할 수 있습니다." />
      </div>
    </>
  );
}

function InfoCard({ title, value, body }: { title: string; value: string; body: string }) {
  return <div className="info-card"><span>{title}</span><b>{value}</b><p>{body}</p></div>;
}

function MobileShell(props: {
  nodes: StudyNode[];
  selectedId?: string;
  route: MobileRoute;
  previewMode: PreviewMode;
  query: string;
  toast: string;
  searchResults: { node: StudyNode; entry: StudyEntry }[];
  setQuery: (value: string) => void;
  setRoute: (route: MobileRoute) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onEmoji: (id: string, emoji: string) => void;
  onAdd: (id?: string) => void;
  onAddEntry: (id: string) => void;
  onEditEntry: (nodeId: string, entryId: string) => void;
  onSaveEntry: (nodeId: string, entry: StudyEntry) => void;
  onDeleteEntry: (nodeId: string, entryId: string) => void;
  onSaveCategory: (parentId: string | undefined, name: string, leaf: boolean, emoji: string, initialEntry?: StudyEntry) => void;
  onDeleteNode: (nodeId: string) => void;
  say: (message: string) => void;
  searchTag: (tag: string) => void;
  maxDepth: number;
}) {
  const selected = findNode(props.nodes, props.selectedId)?.node;
  const [routeStack, setRouteStack] = useState<{ route: MobileRoute; selectedId?: string }[]>([]);
  const [sheet, setSheet] = useState<null | "ctx" | "add" | "entry" | "emoji">(null);
  const [ctxNodeId, setCtxNodeId] = useState<string | undefined>();
  const [ctxEntryId, setCtxEntryId] = useState<string | undefined>();
  const [addParentId, setAddParentId] = useState<string | undefined>();
  const [addLeaf, setAddLeaf] = useState(false);
  const [addEmoji, setAddEmoji] = useState("📁");
  const [addName, setAddName] = useState("");
  const [addEntryTitle, setAddEntryTitle] = useState("");
  const [addEntryDate, setAddEntryDate] = useState(todayISO());
  const [addEntryBody, setAddEntryBody] = useState("- ");
  const [addEntryTags, setAddEntryTags] = useState<string[]>([]);
  const [addTagDraft, setAddTagDraft] = useState("");
  const [entryNodeId, setEntryNodeId] = useState<string | undefined>();
  const [entryId, setEntryId] = useState<string | undefined>();
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [entryBody, setEntryBody] = useState("- ");
  const [entryTags, setEntryTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [toastText, setToastText] = useState("");
  const ctxNode = findNode(props.nodes, ctxNodeId)?.node;
  const ctxEntry = ctxNode?.entries?.find((entry) => entry.id === ctxEntryId);

  useEffect(() => {
    if (!props.toast) return;
    setToastText(props.toast);
    const timer = window.setTimeout(() => setToastText(""), 2200);
    return () => window.clearTimeout(timer);
  }, [props.toast]);

  const longPress = (callback: () => void) => {
    let timer = 0;
    return {
      onPointerDown: () => { timer = window.setTimeout(callback, 600); },
      onPointerUp: () => window.clearTimeout(timer),
      onPointerCancel: () => window.clearTimeout(timer),
      onPointerMove: () => window.clearTimeout(timer)
    };
  };

  const goTo = (route: MobileRoute, nodeId?: string) => {
    setRouteStack((stack) => [...stack, { route: props.route, selectedId: props.selectedId }]);
    if (nodeId) props.onSelect(nodeId);
    props.setRoute(route);
  };

  const goHome = () => {
    setRouteStack([]);
    props.setQuery("");
    props.setRoute("home");
  };

  const goBack = () => {
    setSheet(null);
    setRouteStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) {
        props.setRoute("home");
        return [];
      }
      if (previous.selectedId) props.onSelect(previous.selectedId);
      props.setRoute(previous.route);
      return stack.slice(0, -1);
    });
  };

  const openNode = (node: StudyNode) => {
    if (!hasChildren(node)) goTo("leaf", node.id);
    else {
      props.onToggle(node.id);
      props.setRoute("home");
    }
  };

  const openFolderCard = (node: StudyNode) => {
    goTo(hasChildren(node) ? "folder" : "leaf", node.id);
  };

  const openCtxNode = (nodeId: string) => {
    setCtxNodeId(nodeId);
    setCtxEntryId(undefined);
    setSheet("ctx");
  };

  const openCtxEntry = (nodeId: string, nextEntryId: string) => {
    setCtxNodeId(nodeId);
    setCtxEntryId(nextEntryId);
    setSheet("ctx");
  };

  const openAddSheet = (parentId?: string) => {
    setAddParentId(parentId);
    setAddLeaf(false);
    setAddEmoji("📁");
    setAddName("");
    setAddEntryTitle("");
    setAddEntryDate(todayISO());
    setAddEntryBody("- ");
    setAddEntryTags([]);
    setAddTagDraft("");
    setSheet("add");
  };

  const openEntrySheet = (nodeId: string, nextEntryId?: string) => {
    const node = findNode(props.nodes, nodeId)?.node;
    const existing = node?.entries?.find((entry) => entry.id === nextEntryId);
    setEntryNodeId(nodeId);
    setEntryId(nextEntryId);
    setEntryTitle(existing?.title ?? "");
    setEntryDate(existing?.date ?? todayISO());
    setEntryBody(existing?.body ?? "- ");
    setEntryTags(existing?.tags ?? []);
    setTagDraft("");
    setSheet("entry");
  };

  const saveMobileEntry = () => {
    if (!entryNodeId || !entryTitle.trim()) {
      props.say("제목을 입력해주세요");
      return;
    }
    const node = findNode(props.nodes, entryNodeId)?.node;
    const existing = node?.entries?.find((entry) => entry.id === entryId);
    props.onSaveEntry(entryNodeId, {
      id: existing?.id ?? id("e"),
      title: entryTitle.trim(),
      date: entryDate || todayISO(),
      body: entryBody.trim(),
      attachments: existing?.attachments ?? [],
      tags: [...entryTags]
    });
    setSheet(null);
    props.setRoute("leaf");
  };

  const saveMobileCategory = () => {
    if (!addName.trim()) return;
    const initialEntry = addLeaf && addEntryTitle.trim()
      ? {
          id: id("e"),
          title: addEntryTitle.trim(),
          date: addEntryDate || todayISO(),
          body: addEntryBody.trim(),
          attachments: [],
          tags: [...addEntryTags],
        }
      : undefined;
    props.onSaveCategory(addParentId, addName, addLeaf, addEmoji, initialEntry);
    setSheet(null);
  };

  const tree = (
    <div className="view active" id="v-home">
      <div className="sec-h">내 카테고리</div>
      <div id="tree">
        {props.nodes.map((node) => (
          <MobileTreeNode
            key={node.id}
            node={node}
            nodes={props.nodes}
            openNode={openNode}
            openCtxNode={openCtxNode}
            longPress={longPress}
          />
        ))}
      </div>
    </div>
  );

  let content = tree;
  if (props.query) {
    content = (
      <div className="view active" id="v-search">
        <div className="sec-h">검색 결과 · '{props.query}' · {props.searchResults.length}개</div>
        {props.searchResults.length ? props.searchResults.map(({ node, entry }) => (
          <button className="search-hit" key={entry.id} onClick={() => {
            props.setQuery("");
            goTo("leaf", node.id);
          }}>
            <div className="search-hit-path">{pathTo(props.nodes, node.id).map((item) => item.name).join(" › ")}</div>
            <div className="search-hit-title">{entry.title}</div>
            <div className="search-hit-body">{entry.body.replace(/^[-*]\s*/gm, "").replace(/\n+/g, " ").slice(0, 80)}</div>
            <div className="search-hit-foot"><span>{fmt(entry.date)}</span>{entry.tags.map((tag) => <span className="tag-pill" key={tag}>#{tag}</span>)}</div>
          </button>
        )) : <MobileEmpty emoji="🔍" title="결과가 없어요" body={`'${props.query}'와 관련된 기록을 찾지 못했어요`} />}
      </div>
    );
  } else if (props.route === "stats") {
    content = (
      <div className="view active" id="v-stats">
        <div className="detail-head">
          <div className="badge" style={{ background: "var(--accent-soft)" }}>📊</div>
          <div><h2>학습 통계</h2><p>카테고리·태그·기록 추이</p></div>
        </div>
        <div className="statline">
          <div className="s"><b>{allLeaves(props.nodes).length}</b><span>노트 칸</span></div>
          <div className="s"><b>{allEntries(props.nodes).length}</b><span>총 노트</span></div>
          <div className="s"><b>7</b><span>연속 기록</span></div>
        </div>
        <div className="cat-grid">
          {props.nodes.map((node) => {
            const [_, soft] = palette[(node.colorIndex ?? 0) % palette.length];
            return (
              <button className="cat-card" key={node.id} onClick={() => openFolderCard(node)}>
                <div className="ic" style={{ background: soft }}>{node.emoji}</div>
                <div className="tx"><h4>{node.name}</h4><p>{countEntries(node)}개 노트</p></div>
                <Chev />
              </button>
            );
          })}
        </div>
      </div>
    );
  } else if (props.route === "profile") {
    content = (
      <div className="view active" id="v-me">
        <div className="detail-head">
          <div className="badge" style={{ background: "var(--sky-soft)" }}>🔗</div>
          <div><h2>내정보</h2><p>옵시디언·노트북LM 연동 준비중</p></div>
        </div>
        <div className="cat-grid">
          <div className="cat-card"><div className="ic" style={{ background: "var(--accent-soft)" }}>💾</div><div className="tx"><h4>현재 저장소</h4><p>브라우저 localStorage</p></div></div>
          <div className="cat-card"><div className="ic" style={{ background: "var(--mint-soft)" }}>🗄️</div><div className="tx"><h4>백엔드 후보</h4><p>Supabase 또는 Convex 연결 예정</p></div></div>
          <div className="cat-card"><div className="ic" style={{ background: "var(--sky-soft)" }}>📝</div><div className="tx"><h4>옵시디언</h4><p>노트 URI와 첨부 메타데이터 연결 예정</p></div></div>
        </div>
      </div>
    );
  } else if (selected && (props.route === "folder" || (hasChildren(selected) && props.route !== "leaf"))) {
    content = <MobileFolder node={selected} nodes={props.nodes} maxDepth={props.maxDepth} onBack={goBack} openFolderCard={openFolderCard} openAddSheet={openAddSheet} openCtxNode={openCtxNode} longPress={longPress} />;
  } else if (selected && props.route === "leaf") {
    content = <MobileLeaf node={selected} nodes={props.nodes} onBack={goBack} openEntrySheet={openEntrySheet} openCtxEntry={openCtxEntry} longPress={longPress} />;
  }

  return (
    <section className={`mobile-shell ${props.previewMode === "mobile" ? "is-preview" : ""}`}>
      <div className="phone">
        <div className="screen">
          <div className="punch" />
          <div className="status">
            <span>9:41</span>
            <span className="r"><SignalIcon /><WifiIcon /><BatteryIcon /></span>
          </div>
          <div className="appbar">
            <div className="ttl"><MobileLogo />몽글</div>
            <div className="streak">🔥 7일</div>
          </div>
          <div className="searchbar">
            <SearchIcon className="si" />
            <input id="q" value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="제목·내용·태그 검색… (#태그)" />
            <button className={`sc ${props.query ? "show" : ""}`} onClick={() => props.setQuery("")}>×</button>
          </div>
          <div className="body">{content}</div>
          <nav className="nav">
            <button className={!props.query && props.route === "home" ? "on" : ""} onClick={goHome}><span className="pill" /><HomeIcon />홈</button>
            <button className={props.query ? "on" : ""} onClick={() => document.getElementById("q")?.focus()}><SearchIcon />검색</button>
            <button className={!props.query && props.route === "stats" ? "on" : ""} onClick={() => { setRouteStack([]); props.setQuery(""); props.setRoute("stats"); }}><StatsIcon />통계</button>
            <button className={!props.query && props.route === "profile" ? "on" : ""} onClick={() => { setRouteStack([]); props.setQuery(""); props.setRoute("profile"); }}><MeIcon />내정보</button>
          </nav>
          <div className={`overlay ${sheet && sheet !== "emoji" ? "show" : ""}`} onClick={() => setSheet(null)} />
          <div className={`overlay ${sheet === "emoji" ? "show" : ""}`} style={{ zIndex: 205 }} onClick={() => setSheet(null)} />
          <div className={`sheet ${sheet === "ctx" ? "show" : ""}`}>
            <div className="handle" />
            <div className="ctx-title">{ctxEntry ? ctxEntry.title : ctxNode ? `${ctxNode.emoji} ${ctxNode.name}` : ""}</div>
            {!ctxEntry && ctxNode && depthOf(props.nodes, ctxNode.id) < props.maxDepth && !(ctxNode.entries?.length) && (
              <button className="ctx-btn" onClick={() => {
                setSheet(null);
                openAddSheet(ctxNode.id);
              }}><PlusIcon /><span>새 폴더 추가</span></button>
            )}
            {!ctxEntry && ctxNode && !hasChildren(ctxNode) && (
              <button className="ctx-btn" onClick={() => {
                setSheet(null);
                openEntrySheet(ctxNode.id);
              }}><PlusIcon /><span>새 노트 추가</span></button>
            )}
            {!ctxEntry && ctxNode && <button className="ctx-btn" onClick={() => {
              const next = window.prompt("새 이름", ctxNode.name);
              if (next) props.onRename(ctxNode.id, next);
              setSheet(null);
            }}><EditIcon />이름 변경</button>}
            {!ctxEntry && ctxNode && <button className="ctx-btn" onClick={() => setSheet("emoji")}>😊 이모지 변경</button>}
            {ctxEntry && ctxNode && <button className="ctx-btn" onClick={() => { setSheet(null); openEntrySheet(ctxNode.id, ctxEntry.id); }}><EditIcon />노트 편집</button>}
            <button className="ctx-btn danger" onClick={() => {
              if (ctxEntry && ctxNode) props.onDeleteEntry(ctxNode.id, ctxEntry.id);
              else if (ctxNode) props.onDeleteNode(ctxNode.id);
              setSheet(null);
            }}><TrashIcon />삭제</button>
          </div>
          <div className={`sheet ${sheet === "add" ? "show" : ""}`}>
            <div className="handle" />
            <div className="add-head">
              <button className="em" onClick={() => setSheet("emoji")}>{addEmoji}</button>
              <input value={addName} onChange={(event) => setAddName(event.target.value)} placeholder="이름을 입력하세요…" />
            </div>
            <div className="add-hint">{addParentId ? "하위 폴더를 추가합니다" : "새 최상위 폴더를 추가합니다"}</div>
            {addLeaf && (
              <div className="es-scroll add-leaf-entry">
                <label className="es-label">첫 노트 제목</label>
                <input className="es-input" value={addEntryTitle} onChange={(event) => setAddEntryTitle(event.target.value)} placeholder="오늘 공부한 내용의 제목" />
                <label className="es-label">날짜</label>
                <input className="es-input" type="date" value={addEntryDate} onChange={(event) => setAddEntryDate(event.target.value)} />
                <label className="es-label">내용</label>
                <textarea className="es-input" value={addEntryBody} onChange={(event) => setAddEntryBody(event.target.value)} placeholder={"- 공부 내용을 메모하세요\n줄 앞에 '- '를 붙이면 목록이 됩니다"} />
                <label className="es-label">태그</label>
                <div className="tag-row">{addEntryTags.map((tag) => <span className="tag-pill-rm" key={tag}>#{tag}<button onClick={() => setAddEntryTags(addEntryTags.filter((item) => item !== tag))}>×</button></span>)}</div>
                <div className="tag-add-row">
                  <input className="tag-add-inp" value={addTagDraft} onChange={(event) => setAddTagDraft(event.target.value)} placeholder="태그 입력" />
                  <button className="tag-add-btn" onClick={() => {
                    const next = addTagDraft.trim().replace(/^#/, "");
                    if (next && !addEntryTags.includes(next)) setAddEntryTags([...addEntryTags, next]);
                    setAddTagDraft("");
                  }}>+</button>
                </div>
              </div>
            )}
            <div className="sheet-btns">
              <button className="btn-cancel" onClick={() => setSheet(null)}>취소</button>
              <button className="btn-ok" onClick={saveMobileCategory}>추가</button>
            </div>
          </div>
          <div className={`sheet ${sheet === "entry" ? "show" : ""}`} style={{ maxHeight: "90%" }}>
            <div className="handle" />
            <div className="sheet-title">{entryId ? "노트 편집" : "새 노트"}</div>
            <div className="es-scroll">
              <label className="es-label">제목</label>
              <input className="es-input" value={entryTitle} onChange={(event) => setEntryTitle(event.target.value)} placeholder="오늘 공부한 내용의 제목" />
              <label className="es-label">날짜</label>
              <input className="es-input" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
              <label className="es-label">내용</label>
              <textarea className="es-input" value={entryBody} onChange={(event) => setEntryBody(event.target.value)} placeholder={"- 공부 내용을 메모하세요\n줄 앞에 '- '를 붙이면 목록이 됩니다"} />
              <label className="es-label">태그</label>
              <div className="tag-row">{entryTags.map((tag) => <span className="tag-pill-rm" key={tag}>#{tag}<button onClick={() => setEntryTags(entryTags.filter((item) => item !== tag))}>×</button></span>)}</div>
              <div className="tag-add-row">
                <input className="tag-add-inp" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="태그 입력" />
                <button className="tag-add-btn" onClick={() => {
                  const next = tagDraft.trim().replace(/^#/, "");
                  if (next && !entryTags.includes(next)) setEntryTags([...entryTags, next]);
                  setTagDraft("");
                }}>+</button>
              </div>
            </div>
            <div className="sheet-btns" style={{ marginTop: 16 }}>
              {entryId && entryNodeId && <button className="btn-del" onClick={() => { props.onDeleteEntry(entryNodeId, entryId); setSheet(null); }}>삭제</button>}
              <button className="btn-cancel" onClick={() => setSheet(null)}>취소</button>
              <button className="btn-save" onClick={saveMobileEntry}>저장</button>
            </div>
          </div>
          <div className={`em-picker ${sheet === "emoji" ? "show" : ""}`}>
            <div className="handle" />
            <div className="em-grid">
              {emojis.concat(["🌍", "🌺", "🌼", "🌿", "🌳", "🌊", "🎲", "💎", "🏅"]).map((emoji) => (
                <button key={emoji} onClick={() => {
                  if (ctxNode && !ctxEntry) props.onEmoji(ctxNode.id, emoji);
                  else setAddEmoji(emoji);
                  setSheet(null);
                }}>{emoji}</button>
              ))}
            </div>
          </div>
          <div className="mascot"><div className={`bubble ${toastText ? "show" : ""}`}>{toastText}</div></div>
          <div className="fx" />
          <div className={`toast ${toastText ? "show" : ""}`}>{toastText}</div>
        </div>
      </div>
      {props.previewMode === "mobile" && <p className="caption">몽글 공부 기록 · Android 미리보기</p>}
      {props.previewMode === "mobile" && <button className="dev-exit" onClick={() => props.setPreviewMode("auto")}>↔ 자동 보기</button>}
    </section>
  );
}

function MobileTreeNode({ node, nodes, openNode, openCtxNode, longPress }: {
  node: StudyNode;
  nodes: StudyNode[];
  openNode: (node: StudyNode) => void;
  openCtxNode: (id: string) => void;
  longPress: (callback: () => void) => Record<string, () => void>;
}) {
  const [_, soft] = palette[colorIndexFor(nodes, node.id) % palette.length];
  const latest = hasChildren(node)
    ? `${node.children?.length ?? 0}개 하위`
    : node.entries?.[0]
      ? `${countEntries(node)}개 노트 · ${relDay(node.entries[0].date)}`
      : "노트 없음";
  return (
    <div className={`tnode ${node.open ? "open" : ""}`} data-id={node.id}>
      <div className="trow" onClick={() => openNode(node)} {...longPress(() => openCtxNode(node.id))}>
        <button className="ic" style={{ background: soft }} onClick={(event) => { event.stopPropagation(); openCtxNode(node.id); }}>{node.emoji || (hasChildren(node) ? "📁" : "📘")}</button>
        <div className="tx"><h4>{node.name}</h4><p>{latest}</p></div>
        {countEntries(node) ? <span className="cnt">{countEntries(node)}</span> : null}
        <Chev />
      </div>
      {hasChildren(node) ? <div className="tkids">{node.children!.map((child) => <MobileTreeNode key={child.id} node={child} nodes={nodes} openNode={openNode} openCtxNode={openCtxNode} longPress={longPress} />)}</div> : null}
    </div>
  );
}

function MobileFolder({ node, nodes, maxDepth, onBack, openFolderCard, openAddSheet, openCtxNode, longPress }: {
  node: StudyNode;
  nodes: StudyNode[];
  maxDepth: number;
  onBack: () => void;
  openFolderCard: (node: StudyNode) => void;
  openAddSheet: (parentId?: string, leaf?: boolean) => void;
  openCtxNode: (id: string) => void;
  longPress: (callback: () => void) => Record<string, () => void>;
}) {
  const [_, soft] = palette[colorIndexFor(nodes, node.id) % palette.length];
  const children = node.children ?? [];
  const depth = depthOf(nodes, node.id);
  const insights = folderInsights(node);
  return (
    <div className="view active" id="v-folder">
      <div className="detail-head">
        <button className="btn-back" onClick={onBack}><BackIcon /></button>
        <div className="badge" style={{ background: soft }}>{node.emoji}</div>
        <div><h2>{node.name}</h2><p>{pathTo(nodes, node.id).map((item) => item.name).join(" › ")}</p></div>
      </div>
      <div className="statline action-cards">
        <div className="s"><b>{insights.focus}</b><span>오늘의 초점</span></div>
        <div className="s"><b>{insights.pausedAt}</b><span>최근 멈춘 곳</span></div>
        <div className="s"><b>{insights.empty}</b><span>비어있는 분류</span></div>
        <div className="s"><b>{insights.nextLine}</b><span>다음 한 줄</span></div>
      </div>
      {depth < maxDepth && <button className="btn-add-sub" onClick={() => openAddSheet(node.id)}><PlusIcon />새 폴더 추가</button>}
      <div className="cat-grid">
        {children.length ? children.map((child) => {
          const [__, childSoft] = palette[colorIndexFor(nodes, child.id) % palette.length];
          return (
            <button className="cat-card" key={child.id} onClick={() => openFolderCard(child)} {...longPress(() => openCtxNode(child.id))}>
              <div className="ic" style={{ background: childSoft }}>{child.emoji}</div>
              <div className="tx"><h4>{child.name}</h4><p>{hasChildren(child) ? `${child.children?.length ?? 0}개 하위` : "노트 보관"} · {countEntries(child)}개 노트</p></div>
              <Chev />
            </button>
          );
        }) : <MobileEmpty emoji="📂" title="비어있는 카테고리예요" body="아래 버튼으로 추가해보세요" />}
      </div>
    </div>
  );
}

function MobileLeaf({ node, nodes, onBack, openEntrySheet, openCtxEntry, longPress }: {
  node: StudyNode;
  nodes: StudyNode[];
  onBack: () => void;
  openEntrySheet: (nodeId: string, entryId?: string) => void;
  openCtxEntry: (nodeId: string, entryId: string) => void;
  longPress: (callback: () => void) => Record<string, () => void>;
}) {
  const [_, soft] = palette[colorIndexFor(nodes, node.id) % palette.length];
  const entries = [...(node.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const grouped = entries.reduce<Record<string, StudyEntry[]>>((acc, entry) => {
    acc[entry.date] = acc[entry.date] ?? [];
    acc[entry.date].push(entry);
    return acc;
  }, {});
  const insights = folderInsights(node);
  return (
    <div className="view active" id="v-leaf">
      <div className="detail-head">
        <button className="btn-back" onClick={onBack}><BackIcon /></button>
        <div className="badge" style={{ background: soft }}>{node.emoji}</div>
        <div><h2>{node.name}</h2><p>{pathTo(nodes, node.id).map((item) => item.name).join(" › ")}</p></div>
      </div>
      <div className="statline action-cards">
        <div className="s"><b>{insights.focus}</b><span>오늘의 초점</span></div>
        <div className="s"><b>{insights.pausedAt}</b><span>최근 멈춘 곳</span></div>
        <div className="s"><b>{insights.empty}</b><span>비어있는 분류</span></div>
        <div className="s"><b>{insights.nextLine}</b><span>다음 한 줄</span></div>
      </div>
      {entries.length ? Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map((date) => (
        <div key={date}>
          <div className="daylabel"><span className="d">{fmt(date)}</span><span className="rel">{relDay(date)}</span><span className="ln" /></div>
          {grouped[date].map((entry) => <MobileEntryCard key={entry.id} entry={entry} onDouble={() => openEntrySheet(node.id, entry.id)} longPress={() => openCtxEntry(node.id, entry.id)} longPressHandlers={longPress} />)}
        </div>
      )) : <MobileEmpty emoji="🌱" title="아직 노트가 없어요" body="꾹 눌러 첫 노트를 남겨보세요" />}
    </div>
  );
}

function MobileEntryCard({ entry, onDouble, longPress, longPressHandlers }: {
  entry: StudyEntry;
  onDouble: () => void;
  longPress: () => void;
  longPressHandlers: (callback: () => void) => Record<string, () => void>;
}) {
  const icon = { doc: "📄", video: "🎬", link: "🔗" } satisfies Record<AttachmentType, string>;
  return (
    <div className="ecard" data-eid={entry.id} onDoubleClick={onDouble} {...longPressHandlers(longPress)}>
      <h3><span className="tk">✓</span>{entry.title}</h3>
      <div className="bd">{entry.body.split("\n").map((line, index) => line.startsWith("- ") ? <li key={index}>{line.slice(2)}</li> : <div key={index}>{line}</div>)}</div>
      {entry.attachments.length ? <div className="att">{entry.attachments.map((attachment) => <span className={`chip ${attachment.type}`} key={attachment.id}>{icon[attachment.type]} {attachment.name}</span>)}</div> : null}
      {entry.tags.length ? <div className="tags-row">{entry.tags.map((tag) => <span className="tag-pill" key={tag}>#{tag}</span>)}</div> : null}
    </div>
  );
}

function MobileEmpty({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return <div className="empty"><div className="e">{emoji}</div><h3>{title}</h3><p>{body}</p></div>;
}

function MobileLogo() {
  return <svg className="m" viewBox="0 0 40 40"><rect x="3" y="3" width="34" height="34" rx="12" fill="oklch(94% 0.04 300)" /><circle cx="15" cy="18" r="2.4" fill="oklch(40% 0.05 300)" /><circle cx="25" cy="18" r="2.4" fill="oklch(40% 0.05 300)" /><path d="M15 25 q5 4 10 0" stroke="oklch(64% 0.15 300)" strokeWidth="2.4" strokeLinecap="round" fill="none" /></svg>;
}

function Chev() {
  return <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg>;
}

function SearchIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
}
function HomeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg>; }
function StatsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>; }
function MeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>; }
function SignalIcon() { return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v-3H2zm4 0h2V9H6zm4 0h2V5h-2zm4 0h2v-7h-2zm4 0h2V7h-2z" /></svg>; }
function WifiIcon() { return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4C7 4 3 8 2 10l10 10L22 10C21 8 17 4 12 4z" /></svg>; }
function BatteryIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="18" height="10" rx="2" /><path d="M22 10v4" strokeLinecap="round" /></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m15 18-6-6 6-6" /></svg>; }
function PlusIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>; }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>; }

function ConfirmDeleteModal({ node, onClose, onConfirm }: {
  node?: StudyNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!node) return null;
  const folderCount = node.children?.length ?? 0;
  const entryCount = countEntries(node);
  const parts = [
    folderCount > 0 ? `하위 폴더 ${folderCount}개` : "",
    entryCount > 0 ? `노트 ${entryCount}개` : "",
  ].filter(Boolean);
  return (
    <div className="modal-overlay show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal confirm-modal">
        <div className="modal-head">
          <h3>{node.emoji || "📁"} ‘{node.name}’ 삭제할까요?</h3>
          <IconButton label="닫기" onClick={onClose}>×</IconButton>
        </div>
        <div className="modal-body">
          <p>
            이 카테고리 안에 {parts.join("와 ")}이(가) 들어 있어요.
            함께 삭제되며 되돌릴 수 없어요.
          </p>
        </div>
        <div className="modal-foot">
          <div className="modal-actions">
            <button className="btn-text" onClick={onClose}>취소</button>
            <button className="btn btn-primary danger" onClick={onConfirm}>삭제 🗑️</button>
          </div>
        </div>
      </div>
    </div>
  );
}

type InlineToken = string | { kind: 'strong' | 'em' | 'del' | 'code' | 'wiki' | 'big' | 'small'; text: string } | { kind: 'fs'; text: string; size: number };

function parseInline(text: string, onWiki?: (title: string) => void): JSX.Element {
  const tokens: InlineToken[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|\[\[(.+?)\]\]|\{big\}(.+?)\{\/big\}|\{small\}(.+?)\{\/small\}|\{fs:(\d+)\}(.+?)\{\/fs\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    if (m[1] !== undefined) tokens.push({ kind: 'strong', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'em', text: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'del', text: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: 'code', text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: 'wiki', text: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: 'big', text: m[6] });
    else if (m[7] !== undefined) tokens.push({ kind: 'small', text: m[7] });
    else if (m[8] !== undefined) tokens.push({ kind: 'fs', text: m[9] ?? '', size: parseInt(m[8], 10) });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return (
    <>{tokens.map((t, i) => {
      if (typeof t === 'string') return <span key={i}>{t}</span>;
      if (t.kind === 'strong') return <strong key={i}>{t.text}</strong>;
      if (t.kind === 'em') return <em key={i}>{t.text}</em>;
      if (t.kind === 'del') return <del key={i}>{t.text}</del>;
      if (t.kind === 'code') return <code key={i} className="md-ic">{t.text}</code>;
      if (t.kind === 'wiki') return (
        <button key={i} type="button" className="md-wikilink" onClick={() => onWiki?.(t.text)}>
          [[{t.text}]]
        </button>
      );
      if (t.kind === 'big') return <span key={i} style={{ fontSize: '1.35em', fontWeight: 600 }}>{t.text}</span>;
      if (t.kind === 'small') return <span key={i} style={{ fontSize: '0.78em', opacity: 0.75 }}>{t.text}</span>;
      if (t.kind === 'fs') return <span key={i} style={{ fontSize: `${t.size}px` }}>{t.text}</span>;
      return null;
    })}</>
  );
}

function parseTableRow(line: string): string[] {
  const t = line.trim();
  const w = t.startsWith('|') ? t : `|${t}`;
  const e = w.endsWith('|') ? w : `${w}|`;
  return e.split('|').slice(1, -1).map(c => c.trim());
}

// ── WYSIWYG 에디터 유틸리티 ─────────────────────────────
function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function inlineMdToHtml(text: string): string {
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|\[\[(.+?)\]\]|\{big\}(.+?)\{\/big\}|\{small\}(.+?)\{\/small\}|\{fs:(\d+)\}(.+?)\{\/fs\}/g;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    result += esc(text.slice(last, m.index));
    if (m[1] !== undefined) result += `<strong>${esc(m[1])}</strong>`;
    else if (m[2] !== undefined) result += `<em>${esc(m[2])}</em>`;
    else if (m[3] !== undefined) result += `<del>${esc(m[3])}</del>`;
    else if (m[4] !== undefined) result += `<code class="md-ic">${esc(m[4])}</code>`;
    else if (m[5] !== undefined) result += `<span class="md-wiki">${esc(m[5])}</span>`;
    else if (m[6] !== undefined) result += `<span class="md-big">${esc(m[6])}</span>`;
    else if (m[7] !== undefined) result += `<span class="md-small">${esc(m[7])}</span>`;
    else if (m[8] !== undefined) result += `<span class="md-fs" style="font-size:${m[8]}px">${esc(m[9] ?? '')}</span>`;
    last = m.index + m[0].length;
  }
  return result + esc(text.slice(last));
}

function markdownToHtml(text: string): string {
  if (!text.trim()) return '<p><br></p>';
  const lines = text.split('\n');
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hrLine = line.trim();
    {
      const hrm = hrLine.match(/^(-{3,}|- - -|· · ·|= = =|\* \* \*)(?:\s+w(\d+))?$/);
      if (hrm) {
        const w = parseInt(hrm[2] ?? '100', 10);
        const ws = w < 100 ? ` style="width:${w}%;margin-left:auto;margin-right:auto"` : '';
        const typeMap: Record<string, string> = { '- - -': 'md-hr md-hr-dashed', '· · ·': 'md-hr md-hr-dotted', '= = =': 'md-hr md-hr-double', '* * *': 'md-hr md-hr-deco' };
        const cls = typeMap[hrm[1]] ?? 'md-hr';
        parts.push(`<hr class="${cls}"${ws}>`); i++; continue;
      }
    }
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) { parts.push(`<h${hm[1].length}>${inlineMdToHtml(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(esc(lines[i])); i++; }
      parts.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`); i++; continue;
    }
    if (line.startsWith('> ')) { parts.push(`<blockquote class="md-bq">${inlineMdToHtml(line.slice(2))}</blockquote>`); i++; continue; }
    const cbm = line.match(/^[-*]\s+\[([x ])\]\s+(.*)$/i);
    if (cbm) {
      parts.push(`<div class="md-check"><input type="checkbox"${cbm[1].toLowerCase() === 'x' ? ' checked' : ''}><span>${inlineMdToHtml(cbm[2])}</span></div>`);
      i++; continue;
    }
    if (/^[-*]\s+/.test(line) && !line.match(/^[-*]\s+\[/)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]) && !lines[i].match(/^[-*]\s+\[/)) {
        items.push(`<li>${inlineMdToHtml(lines[i].replace(/^[-*]\s+/, ''))}</li>`); i++;
      }
      parts.push(`<ul class="md-ul">${items.join('')}</ul>`); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMdToHtml(lines[i].replace(/^\d+\.\s+/, ''))}</li>`); i++;
      }
      parts.push(`<ol class="md-ol">${items.join('')}</ol>`); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\|?[\w\s%.:|-]+\|/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      const sepLine = lines[i + 1];
      i += 2;
      const sepCells = parseTableRow(sepLine);
      const colWidths = sepCells.map(cell => { const m = cell.trim().match(/^--w:(.+)--$/); return m ? m[1] : null; });
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseTableRow(lines[i])); i++; }
      parts.push(`<table class="md-table"><thead><tr>${headers.map((h, idx) => `<th${colWidths[idx] ? ` style="width:${colWidths[idx]}"` : ''}>${inlineMdToHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inlineMdToHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (!line.trim()) { parts.push('<div class="md-gap"><br></div>'); i++; continue; }
    parts.push(`<p class="md-p">${inlineMdToHtml(line)}</p>`); i++;
  }
  return parts.join('') || '<p><br></p>';
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase() ?? '';
  const inner = () => Array.from(el.childNodes).map(nodeToMd).join('');
  switch (tag) {
    case 'h1': return `# ${inner()}`;
    case 'h2': return `## ${inner()}`;
    case 'h3': return `### ${inner()}`;
    case 'p': {
      if (el.classList.contains('md-gap')) return '';
      const v = inner();
      return (v === '' || v === '\n') ? '' : v;
    }
    case 'div': {
      if (el.classList.contains('md-gap')) return '';
      if (el.classList.contains('md-check')) {
        const cb = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const span = el.querySelector('span') ?? el;
        return `- [${cb?.checked ? 'x' : ' '}] ${Array.from(span.childNodes).map(nodeToMd).join('')}`;
      }
      const v = inner();
      return (v === '' || v === '\n') ? '' : v;
    }
    case 'blockquote': return `> ${inner()}`;
    case 'hr': {
      const hrEl = el as HTMLElement;
      const wm = hrEl.style?.width?.match(/^(\d+)%$/);
      const w = wm ? parseInt(wm[1], 10) : 100;
      const ws = w < 100 ? ` w${w}` : '';
      if (el.classList.contains('md-hr-dashed')) return `- - -${ws}`;
      if (el.classList.contains('md-hr-dotted')) return `· · ·${ws}`;
      if (el.classList.contains('md-hr-double')) return `= = =${ws}`;
      if (el.classList.contains('md-hr-deco')) return `* * *${ws}`;
      return `---${ws}`;
    }
    case 'br': return '';
    case 'ul': return Array.from(el.querySelectorAll(':scope > li')).map(li => `- ${Array.from(li.childNodes).map(nodeToMd).join('')}`).join('\n');
    case 'ol': return Array.from(el.querySelectorAll(':scope > li')).map((li, idx) => `${idx + 1}. ${Array.from(li.childNodes).map(nodeToMd).join('')}`).join('\n');
    case 'pre': {
      const codeEls = Array.from(el.querySelectorAll('code'));
      const text = codeEls.length > 0
        ? codeEls.map(c => c.textContent ?? '').join('')
        : el.textContent ?? '';
      return `\`\`\`\n${text}\n\`\`\``;
    }
    case 'table': {
      const thEls = Array.from(el.querySelectorAll('thead th')) as HTMLElement[];
      if (!thEls.length) return inner();
      const ths = thEls.map(th => th.textContent ?? '');
      const trs = Array.from(el.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent ?? ''));
      const colWidths = thEls.map(th => th.style.width || '');
      const hasWidths = colWidths.some(w => w);
      const sep = hasWidths ? colWidths.map(w => w ? `--w:${w}--` : '------').join('|') : ths.map(() => '------').join('|');
      return `| ${ths.join(' | ')} |\n|${sep}|\n${trs.map(r => `| ${r.join(' | ')} |`).join('\n')}`;
    }
    case 'strong': case 'b': return `**${inner()}**`;
    case 'em': case 'i': return `*${inner()}*`;
    case 'del': case 's': case 'strike': return `~~${inner()}~~`;
    case 'code': return el.closest('pre') ? (el.textContent ?? '') : `\`${el.textContent ?? ''}\``;
    case 'span': {
      if (el.classList.contains('md-wiki')) return `[[${el.textContent ?? ''}]]`;
      if (el.classList.contains('md-big')) return `{big}${inner()}{/big}`;
      if (el.classList.contains('md-small')) return `{small}${inner()}{/small}`;
      if (el.classList.contains('md-fs')) {
        const sz = Math.round(parseFloat((el as HTMLElement).style?.fontSize) || 14);
        return `{fs:${sz}}${inner()}{/fs}`;
      }
      const style = el.getAttribute('style') ?? '';
      if (/font-weight\s*:\s*(bold|700)/i.test(style)) return `**${inner()}**`;
      if (/font-style\s*:\s*italic/i.test(style)) return `*${inner()}*`;
      return inner();
    }
    default: return inner();
  }
}

function htmlToMarkdown(el: HTMLElement): string {
  return Array.from(el.childNodes).map(nodeToMd).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function MarkdownPreview({ text, onWikiLink }: { text: string; onWikiLink?: (title: string) => void }) {
  const lines = text.split('\n');
  const blocks: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push(<hr key={i} className="md-hr" />); i++; continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const lv = hm[1].length;
      const Tag = `h${lv}` as 'h1' | 'h2' | 'h3';
      blocks.push(<Tag key={i} className={`md-h md-h${lv}`}>{parseInline(hm[2], onWikiLink)}</Tag>);
      i++; continue;
    }
    if (line.startsWith('```')) {
      const codeLines: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      blocks.push(<pre key={i} className="md-pre"><code>{codeLines.join('\n')}</code></pre>);
      i++; continue;
    }
    if (line.startsWith('> ')) {
      blocks.push(<blockquote key={i} className="md-bq">{parseInline(line.slice(2), onWikiLink)}</blockquote>);
      i++; continue;
    }
    const cbm = line.match(/^[-*]\s+\[([x ])\]\s+(.*)$/i);
    if (cbm) {
      blocks.push(
        <div key={i} className="md-check">
          <input type="checkbox" defaultChecked={cbm[1].toLowerCase() === 'x'} readOnly />
          <label>{parseInline(cbm[2], onWikiLink)}</label>
        </div>
      ); i++; continue;
    }
    if (/^[-*]\s+/.test(line) && !line.match(/^[-*]\s+\[/)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]) && !lines[i].match(/^[-*]\s+\[/)) {
        items.push(<li key={i}>{parseInline(lines[i].replace(/^[-*]\s+/, ''), onWikiLink)}</li>); i++;
      }
      if (items.length) { blocks.push(<ul key={`ul${i}`} className="md-ul">{items}</ul>); continue; }
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(<li key={i}>{parseInline(lines[i].replace(/^\d+\.\s+/, ''), onWikiLink)}</li>); i++;
      }
      blocks.push(<ol key={`ol${i}`} className="md-ol">{items}</ol>); continue;
    }
    // Table: current line has | and next line is a separator
    if (line.includes('|') && i + 1 < lines.length && /^\|?[\w\s%.:|-]+\|/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      const sepLine = lines[i + 1];
      i += 2;
      const sepCells = parseTableRow(sepLine);
      const colWidths = sepCells.map(cell => { const m = cell.trim().match(/^--w:(.+)--$/); return m ? m[1] : null; });
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseTableRow(lines[i])); i++; }
      blocks.push(
        <table key={`tbl${i}`} className="md-table">
          <thead><tr>{headers.map((h, j) => <th key={j} style={colWidths[j] ? {width: colWidths[j]} : undefined}>{parseInline(h, onWikiLink)}</th>)}</tr></thead>
          <tbody>{rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{parseInline(cell, onWikiLink)}</td>)}</tr>)}</tbody>
        </table>
      );
      continue;
    }
    if (!line.trim()) { blocks.push(<div key={i} className="md-gap" />); i++; continue; }
    blocks.push(<p key={i} className="md-p">{parseInline(line, onWikiLink)}</p>); i++;
  }
  return <div className="md-preview">{blocks}</div>;
}

function MarkdownToolbar({ taRef, value, onChange, allEntryTitles }: {
  taRef: { current: HTMLTextAreaElement | null };
  value: string;
  onChange: (v: string) => void;
  allEntryTitles?: string[];
}) {
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  const wrap = (before: string, after: string, ph: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = s !== e ? value.slice(s, e) : ph;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); }, 0);
  };
  const prefix = (pfx: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const ls = value.lastIndexOf('\n', s - 1) + 1;
    const le = value.indexOf('\n', s);
    const end = le === -1 ? value.length : le;
    const line = value.slice(ls, end);
    const has = line.startsWith(pfx);
    const newLine = has ? line.slice(pfx.length) : pfx + line;
    const next = value.slice(0, ls) + newLine + value.slice(end);
    onChange(next);
    setTimeout(() => { ta.focus(); const np = s + (has ? -pfx.length : pfx.length); ta.setSelectionRange(np, np); }, 0);
  };
  const insert = (text: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const next = value.slice(0, s) + text + value.slice(s);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + text.length, s + text.length); }, 0);
  };
  const insertWikiLink = (title: string) => {
    insert(`[[${title}]]`);
    setShowLinkPicker(false);
    setLinkSearch('');
  };

  const filteredTitles = (allEntryTitles ?? []).filter(t => t.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 12);

  return (
    <div className="md-toolbar-wrap">
      <div className="md-toolbar">
        <button type="button" className="tb" title="굵게 (**)" onClick={() => wrap('**', '**', '굵게')}><b>B</b></button>
        <button type="button" className="tb" title="기울임 (*)" onClick={() => wrap('*', '*', '기울임')}><i>I</i></button>
        <button type="button" className="tb" title="취소선 (~~)" onClick={() => wrap('~~', '~~', '취소선')}><s>S</s></button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="크게 ({big})" onClick={() => wrap('{big}', '{/big}', '큰 텍스트')}>A+</button>
        <button type="button" className="tb" title="작게 ({small})" onClick={() => wrap('{small}', '{/small}', '작은 텍스트')}>a-</button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="제목 1 (#)" onClick={() => prefix('# ')}>H1</button>
        <button type="button" className="tb" title="제목 2 (##)" onClick={() => prefix('## ')}>H2</button>
        <button type="button" className="tb" title="제목 3 (###)" onClick={() => prefix('### ')}>H3</button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="목록 (-)" onClick={() => prefix('- ')}>•≡</button>
        <button type="button" className="tb" title="체크박스 (- [ ])" onClick={() => prefix('- [ ] ')}>☑</button>
        <button type="button" className="tb" title="인용 (>)" onClick={() => prefix('> ')}>❝</button>
        <span className="tb-sep" />
        <button type="button" className="tb mono" title="인라인 코드 (`)" onClick={() => wrap('`', '`', 'code')}>`cd`</button>
        <button type="button" className="tb" title="구분선 (---)" onClick={() => insert('\n---\n')}>—</button>
        <button type="button" className="tb" title="표 삽입" onClick={() => insert('\n| 제목1 | 제목2 | 제목3 |\n|------|------|------|\n| 내용1 | 내용2 | 내용3 |\n')}>⊞</button>
        <span className="tb-sep" />
        <button
          type="button"
          className={`tb tb-link${showLinkPicker ? ' active' : ''}`}
          title="노트 링크 [[]]"
          onClick={() => setShowLinkPicker(v => !v)}
        >🔗 [[]]</button>
      </div>
      {showLinkPicker && (
        <div className="link-picker">
          <input
            className="link-picker-search"
            placeholder="노트 이름 검색..."
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
            autoFocus
          />
          <div className="link-picker-list">
            {filteredTitles.length === 0 ? (
              <div className="link-picker-empty">노트가 없습니다</div>
            ) : filteredTitles.map(t => (
              <button key={t} type="button" className="link-picker-item" onClick={() => insertWikiLink(t)}>{t}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── WYSIWYG 툴바 ──────────────────────────────────────
function WysiwygToolbar({ divRef, sync, allEntryTitles }: {
  divRef: React.RefObject<HTMLDivElement | null>;
  sync: () => void;
  allEntryTitles?: string[];
}) {
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [showHrPicker, setShowHrPicker] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  const focus = () => divRef.current?.focus();

  const exec = (cmd: string, val?: string) => {
    focus();
    document.execCommand(cmd, false, val);
    sync();
  };

  const insertHtml = (html: string) => {
    focus();
    document.execCommand('insertHTML', false, html);
    sync();
  };

  const wrapSpan = (className: string, placeholder: string) => {
    focus();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const hadSelection = !sel.isCollapsed;
    const txt = sel.isCollapsed ? placeholder : sel.toString();
    const tmpId = `tmp-${Math.random().toString(36).slice(2)}`;
    document.execCommand('insertHTML', false, `<span id="${tmpId}" class="${className}">${esc(txt)}</span>`);
    const span = divRef.current?.querySelector(`#${tmpId}`);
    if (span) {
      span.removeAttribute('id');
      if (hadSelection) {
        const r = document.createRange();
        r.selectNodeContents(span);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
    }
    sync();
  };

  const insertHr = (type: 'solid' | 'dashed' | 'dotted' | 'double' | 'deco') => {
    const cls = type === 'solid' ? 'md-hr' : `md-hr md-hr-${type}`;
    insertHtml(`<hr class="${cls}"><p><br></p>`);
    setShowHrPicker(false);
  };

  const insertWikiLink = (title: string) => {
    insertHtml(`<span class="md-wiki">${esc(title)}</span>&nbsp;`);
    setShowLinkPicker(false);
    setLinkSearch('');
  };

  const filteredTitles = (allEntryTitles ?? [])
    .filter(t => t.toLowerCase().includes(linkSearch.toLowerCase()))
    .slice(0, 12);

  return (
    <div className="md-toolbar-wrap" onMouseDown={(e) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    }}>
      <div className="md-toolbar">
        <button type="button" className="tb" title="굵게 (Ctrl+B)" onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" className="tb" title="기울임 (Ctrl+I)" onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" className="tb" title="취소선" onClick={() => exec('strikeThrough')}><s>S</s></button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="크게 (Ctrl+Shift+>)" onClick={() => wrapSpan('md-big', '큰 텍스트')}><b>A+</b></button>
        <button type="button" className="tb" title="작게 (Ctrl+Shift+<)" onClick={() => wrapSpan('md-small', '작은 텍스트')}><small>a−</small></button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="제목 1" onClick={() => exec('formatBlock', 'h1')}>H1</button>
        <button type="button" className="tb" title="제목 2" onClick={() => exec('formatBlock', 'h2')}>H2</button>
        <button type="button" className="tb" title="제목 3" onClick={() => exec('formatBlock', 'h3')}>H3</button>
        <span className="tb-sep" />
        <button type="button" className="tb" title="목록" onClick={() => exec('insertUnorderedList')}>•≡</button>
        <button type="button" className="tb" title="체크박스" onClick={() => insertHtml('<div class="md-check"><input type="checkbox"><span>&nbsp;할 일</span></div><p><br></p>')}>☑</button>
        <button type="button" className="tb" title="인용" onClick={() => exec('formatBlock', 'blockquote')}>❝</button>
        <span className="tb-sep" />
        <button type="button" className="tb mono" title="인라인 코드" onClick={() => insertHtml('<code class="md-ic">code</code>')}>`cd`</button>
        <button
          type="button"
          className={`tb${showHrPicker ? ' active' : ''}`}
          title="구분선"
          onClick={() => { setShowHrPicker(v => !v); setShowLinkPicker(false); }}
        >—▾</button>
        <button type="button" className="tb" title="표 삽입" onClick={() => insertHtml(
          '<table class="md-table"><thead><tr><th>제목1</th><th>제목2</th><th>제목3</th></tr></thead>' +
          '<tbody><tr><td>내용1</td><td>내용2</td><td>내용3</td></tr></tbody></table><p><br></p>'
        )}>⊞</button>
        <span className="tb-sep" />
        <button
          type="button"
          className={`tb tb-link${showLinkPicker ? ' active' : ''}`}
          title="노트 링크 [[]]"
          onClick={() => { setShowLinkPicker(v => !v); setShowHrPicker(false); }}
        >🔗 [[]]</button>
      </div>
      {showHrPicker && (
        <div className="hr-picker">
          <button type="button" className="hr-pick-item" onClick={() => insertHr('solid')}><span className="hr-preview hr-solid" />실선</button>
          <button type="button" className="hr-pick-item" onClick={() => insertHr('dashed')}><span className="hr-preview hr-dashed" />점선</button>
          <button type="button" className="hr-pick-item" onClick={() => insertHr('dotted')}><span className="hr-preview hr-dotted" />점</button>
          <button type="button" className="hr-pick-item" onClick={() => insertHr('double')}><span className="hr-preview hr-double" />이중선</button>
          <button type="button" className="hr-pick-item" onClick={() => insertHr('deco')}>✦ 장식선</button>
        </div>
      )}
      {showLinkPicker && (
        <div className="link-picker">
          <input
            className="link-picker-search"
            placeholder="노트 이름 검색..."
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
            autoFocus
          />
          <div className="link-picker-list">
            {filteredTitles.length === 0 ? (
              <div className="link-picker-empty">노트가 없습니다</div>
            ) : filteredTitles.map(t => (
              <button key={t} type="button" className="link-picker-item" onClick={() => insertWikiLink(t)}>{t}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── WYSIWYG 에디터 ─────────────────────────────────────
function WysiwygEditor({ value, onChange, placeholder, onWikiLink, allEntryTitles }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onWikiLink?: (title: string) => void;
  allEntryTitles?: string[];
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const isEditingRef = useRef(false);
  const valueRef = useRef(value);
  const [hrCtx, setHrCtx] = useState<{ el: HTMLElement; x: number; y: number } | null>(null);
  const [tableCtx, setTableCtx] = useState<{ table: HTMLElement; td: HTMLElement; x: number; y: number } | null>(null);
  const colResizeRef = useRef<{ ths: HTMLElement[]; idx: number; startX: number; startWidths: number[] } | null>(null);

  useEffect(() => {
    const close = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.hr-ctx')) setHrCtx(null);
      if (!t.closest('.table-ctx')) setTableCtx(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const updateTableCtx = (el: HTMLElement | null) => {
    const tdEl = el?.closest('td, th') as HTMLElement | null;
    const tableEl = el?.closest('table') as HTMLElement | null;
    if (tdEl && tableEl && divRef.current?.contains(tableEl)) {
      const rect = tableEl.getBoundingClientRect();
      setTableCtx({ table: tableEl, td: tdEl, x: rect.left, y: Math.max(4, rect.top - 42) });
    } else if (!el?.closest('.table-ctx')) {
      setTableCtx(null);
    }
  };

  const getColIdx = (td: HTMLElement) => {
    const tr = td.closest('tr');
    return tr ? Array.from(tr.querySelectorAll('td, th')).indexOf(td) : -1;
  };

  const addRowBelow = () => {
    if (!tableCtx) return;
    const tr = tableCtx.td.closest('tr');
    if (!tr) return;
    const colCount = tr.querySelectorAll('td, th').length;
    const newTr = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td'); td.innerHTML = '<br>'; newTr.appendChild(td);
    }
    tr.after(newTr);
    sync();
  };

  const deleteRow = () => {
    if (!tableCtx) return;
    const tr = tableCtx.td.closest('tr');
    if (!tr) return;
    tr.remove();
    sync();
    setTableCtx(null);
  };

  const addColRight = () => {
    if (!tableCtx) return;
    const colIdx = getColIdx(tableCtx.td);
    if (colIdx < 0) return;
    tableCtx.table.querySelectorAll('tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td, th'));
      const isHead = !!tr.closest('thead');
      const cell = document.createElement(isHead ? 'th' : 'td');
      cell.innerHTML = '<br>';
      const ref = cells[colIdx];
      if (ref) ref.after(cell); else tr.appendChild(cell);
    });
    sync();
  };

  const deleteCol = () => {
    if (!tableCtx) return;
    const colIdx = getColIdx(tableCtx.td);
    if (colIdx < 0) return;
    const firstRow = tableCtx.table.querySelector('tr');
    if (!firstRow || firstRow.querySelectorAll('td, th').length <= 1) return;
    tableCtx.table.querySelectorAll('tr').forEach(tr => {
      Array.from(tr.querySelectorAll('td, th'))[colIdx]?.remove();
    });
    sync();
    setTableCtx(null);
  };

  const equalizeColWidths = () => {
    if (!tableCtx) return;
    const headerRow = tableCtx.table.querySelector('thead tr') as HTMLElement | null;
    const ths = Array.from((headerRow ?? tableCtx.table.querySelector('tr'))?.querySelectorAll('th') ?? []) as HTMLElement[];
    if (!ths.length) return;
    const w = `${(100 / ths.length).toFixed(2)}%`;
    ths.forEach(th => { th.style.width = w; });
    sync();
  };

  const equalizeRowHeights = () => {
    if (!tableCtx) return;
    const rows = Array.from(tableCtx.table.querySelectorAll('tbody tr')) as HTMLElement[];
    if (!rows.length) return;
    rows.forEach(tr => Array.from(tr.querySelectorAll('td')).forEach(td => { (td as HTMLElement).style.height = ''; }));
    const maxH = Math.max(...rows.map(tr => tr.offsetHeight));
    rows.forEach(tr => Array.from(tr.querySelectorAll('td')).forEach(td => { (td as HTMLElement).style.height = `${maxH}px`; }));
    sync();
  };

  const handleEditorMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (colResizeRef.current) return;
    const target = e.target as HTMLElement;
    const cell = target.closest('td, th') as HTMLElement | null;
    if (cell && divRef.current?.contains(cell)) {
      const rect = cell.getBoundingClientRect();
      const tr = cell.closest('tr') as HTMLElement | null;
      const cells = Array.from(tr?.querySelectorAll('td, th') ?? []) as HTMLElement[];
      const idx = cells.indexOf(cell);
      if (idx < cells.length - 1 && e.clientX >= rect.right - 7) {
        if (divRef.current) divRef.current.style.cursor = 'col-resize';
        return;
      }
    }
    if (divRef.current) divRef.current.style.cursor = '';
  };

  const handleEditorMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cell = target.closest('td, th') as HTMLElement | null;
    if (!cell || !divRef.current?.contains(cell)) return;
    const rect = cell.getBoundingClientRect();
    if (e.clientX < rect.right - 7) return;
    const table = cell.closest('table') as HTMLElement | null;
    if (!table) return;
    const tr = cell.closest('tr') as HTMLElement | null;
    const cellsInRow = Array.from(tr?.querySelectorAll('td, th') ?? []) as HTMLElement[];
    const cellIdx = cellsInRow.indexOf(cell);
    const headerRow = table.querySelector('thead tr') as HTMLElement | null;
    const ths = Array.from((headerRow ?? table.querySelector('tr'))?.querySelectorAll('th') ?? []) as HTMLElement[];
    if (!ths.length || cellIdx < 0 || cellIdx >= ths.length - 1) return;
    e.preventDefault();
    const startWidths = ths.map(th => {
      if (th.style.width && th.style.width.endsWith('%')) {
        return (parseFloat(th.style.width) / 100) * table.offsetWidth;
      }
      return th.offsetWidth;
    });
    ths.forEach((th, i) => { th.style.width = `${startWidths[i]}px`; });
    colResizeRef.current = { ths, idx: cellIdx, startX: e.clientX, startWidths };
    const onMove = (ev: Event) => {
      if (!colResizeRef.current) return;
      const { ths: rThs, idx, startX, startWidths: sw } = colResizeRef.current;
      const dx = (ev as unknown as { clientX: number }).clientX - startX;
      rThs[idx].style.width = `${Math.max(40, sw[idx] + dx)}px`;
      if (rThs[idx + 1]) rThs[idx + 1].style.width = `${Math.max(40, sw[idx + 1] - dx)}px`;
    };
    const onUp = () => {
      colResizeRef.current = null;
      if (divRef.current) divRef.current.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      sync();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useLayoutEffect(() => {
    if (divRef.current) divRef.current.innerHTML = markdownToHtml(value);
  // only on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    valueRef.current = value;
    if (!isEditingRef.current && divRef.current) {
      divRef.current.innerHTML = markdownToHtml(value);
    }
  }, [value]);

  const sync = () => {
    if (!divRef.current) return;
    const md = htmlToMarkdown(divRef.current);
    valueRef.current = md;
    onChange(md);
  };

  const handleBlur = () => {
    isEditingRef.current = false;
    sync(); // blur 시 최신 DOM 상태를 즉시 캡처
    const snapshot = valueRef.current;
    setTimeout(() => {
      if (!isEditingRef.current && divRef.current) {
        divRef.current.innerHTML = markdownToHtml(snapshot);
      }
    }, 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = (range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer) as HTMLElement | null;

    // Ctrl+Shift+> / < → 글씨 크기 1px씩 증감 (선택 영역 유지)
    if (e.ctrlKey && e.shiftKey && (e.key === '>' || e.key === '<')) {
      e.preventDefault();
      if (sel.isCollapsed) return;
      const dir = e.key === '>' ? 1 : -1;
      const container = (range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer) as HTMLElement | null;
      const fsSpan = container?.closest('span.md-fs') as HTMLElement | null;
      if (fsSpan && divRef.current?.contains(fsSpan)) {
        const cur = parseFloat(fsSpan.style.fontSize) || 14;
        fsSpan.style.fontSize = `${Math.max(8, Math.min(72, cur + dir))}px`;
        const r = document.createRange();
        r.selectNodeContents(fsSpan);
        sel.removeAllRanges();
        sel.addRange(r);
      } else {
        const txt = sel.toString();
        const newSize = 14 + dir;
        const tmpId = `tmp-${Math.random().toString(36).slice(2)}`;
        document.execCommand('insertHTML', false, `<span id="${tmpId}" class="md-fs" style="font-size:${newSize}px">${esc(txt)}</span>`);
        const span = divRef.current?.querySelector(`#${tmpId}`) as HTMLElement | null;
        if (span) {
          span.removeAttribute('id');
          const r = document.createRange();
          r.selectNodeContents(span);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      sync();
      return;
    }

    if (e.key !== 'Enter') return;

    // 인라인 코드에서 Shift+Enter → pre 코드블록으로 변환
    if (e.shiftKey) {
      const codeEl = node?.closest('code');
      if (codeEl && !codeEl.closest('pre') && divRef.current?.contains(codeEl)) {
        e.preventDefault();
        const content = codeEl.textContent ?? '';
        const pre = document.createElement('pre');
        pre.className = 'md-pre';
        const inner = document.createElement('code');
        inner.textContent = content + '\n';
        pre.appendChild(inner);
        codeEl.replaceWith(pre);
        const textNode = inner.firstChild as Text | null;
        if (textNode) {
          const r = document.createRange();
          r.setStart(textNode, textNode.length);
          r.collapse(true);
          const s = window.getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
        }
        sync();
        return;
      }
    }

    // pre 코드블록 안에서 Enter → 줄바꿈 삽입 (블록 유지)
    const preEl = node?.closest('pre');
    if (preEl && divRef.current?.contains(preEl)) {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      sync();
      return;
    }

    // 인라인 요소(code, span) 안에서 Enter → 블록 밖에 새 단락으로 이동
    const inlineEl = node?.closest('code, span');
    if (inlineEl && inlineEl !== divRef.current && divRef.current?.contains(inlineEl)) {
      e.preventDefault();
      const blockEl = inlineEl.closest('p, li, blockquote');
      const insertAfter = (blockEl && blockEl !== divRef.current) ? blockEl : inlineEl;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      insertAfter.after(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      sync();
      return;
    }

    // 제목 안에서 Enter → 새 단락 생성
    const headingEl = node?.closest('h1,h2,h3');
    if (headingEl) {
      e.preventDefault();
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      headingEl.after(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      sync();
      return;
    }

    // 단락에 # ## ### 문법 입력 후 Enter → 제목으로 변환
    const paraEl = node?.closest('p,div');
    if (paraEl && paraEl !== divRef.current) {
      const text = paraEl.textContent || '';
      const hm = text.match(/^(#{1,3})\s+(.+)$/);
      if (hm) {
        e.preventDefault();
        const lv = hm[1].length as 1 | 2 | 3;
        const h = document.createElement(`h${lv}`) as HTMLElement;
        h.textContent = hm[2];
        paraEl.replaceWith(h);
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        h.after(p);
        const r = document.createRange();
        r.setStart(p, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        sync();
        return;
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertHTML', false, markdownToHtml(text));
      sync();
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
      e.preventDefault();
      const cb = target as HTMLInputElement;
      cb.checked = !cb.checked;
      sync();
      return;
    }
    if (target.tagName === 'HR') {
      const rect = target.getBoundingClientRect();
      setHrCtx({ el: target, x: rect.left, y: rect.bottom + 6 });
      setTableCtx(null);
      const s = window.getSelection();
      if (s) {
        const r = document.createRange();
        r.setStartBefore(target);
        r.setEndAfter(target);
        s.removeAllRanges();
        s.addRange(r);
      }
    } else {
      setHrCtx(null);
      updateTableCtx(target);
    }
    if (target.classList.contains('md-wiki') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onWikiLink?.(target.textContent || '');
    }
  };

  const handleKeyUp = () => {
    const s = window.getSelection();
    if (!s?.rangeCount) return;
    const r = s.getRangeAt(0);
    const el = (r.commonAncestorContainer.nodeType === 3
      ? r.commonAncestorContainer.parentElement
      : r.commonAncestorContainer) as HTMLElement | null;
    updateTableCtx(el);
  };

  return (
    <div className="wysiwyg-wrap">
      <WysiwygToolbar divRef={divRef} sync={sync} allEntryTitles={allEntryTitles} />
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        className="wysiwyg-editor"
        data-placeholder={placeholder}
        onFocus={() => { isEditingRef.current = true; }}
        onBlur={handleBlur}
        onInput={sync}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onPaste={handlePaste}
        onClick={handleClick}
        onMouseMove={handleEditorMouseMove}
        onMouseDown={handleEditorMouseDown}
      />
      {hrCtx && (
        <div
          className="hr-ctx"
          style={{ position: 'fixed', top: hrCtx.y, left: hrCtx.x, zIndex: 9999 }}
          onMouseDown={e => e.preventDefault()}
        >
          <span className="hr-ctx-label">너비</span>
          {([25, 50, 75, 100] as const).map(w => {
            const curW = hrCtx.el.style.width;
            const isActive = curW === `${w}%` || (!curW && w === 100);
            return (
              <button
                key={w}
                type="button"
                className={`hr-ctx-btn${isActive ? ' active' : ''}`}
                onClick={() => {
                  hrCtx.el.style.width = w < 100 ? `${w}%` : '';
                  hrCtx.el.style.marginLeft = w < 100 ? 'auto' : '';
                  hrCtx.el.style.marginRight = w < 100 ? 'auto' : '';
                  sync();
                  setHrCtx({ ...hrCtx });
                }}
              >{w}%</button>
            );
          })}
          <span className="hr-ctx-sep" />
          <button
            type="button"
            className="hr-ctx-btn hr-ctx-del"
            onClick={() => { hrCtx.el.remove(); sync(); setHrCtx(null); }}
          >삭제</button>
        </div>
      )}
      {tableCtx && (
        <div
          className="table-ctx"
          style={{ position: 'fixed', top: tableCtx.y, left: tableCtx.x, zIndex: 9999 }}
          onMouseDown={e => e.preventDefault()}
        >
          <span className="hr-ctx-label">행</span>
          <button type="button" className="hr-ctx-btn table-ctx-btn" title="아래에 행 추가" onClick={addRowBelow}>+ 행</button>
          <button type="button" className="hr-ctx-btn table-ctx-btn hr-ctx-del" title="행 삭제" onClick={deleteRow}>− 행</button>
          <button type="button" className="hr-ctx-btn table-ctx-btn" title="행 높이 균등" onClick={equalizeRowHeights}>행↕</button>
          <span className="hr-ctx-sep" />
          <span className="hr-ctx-label">열</span>
          <button type="button" className="hr-ctx-btn table-ctx-btn" title="오른쪽에 열 추가" onClick={addColRight}>+ 열</button>
          <button type="button" className="hr-ctx-btn table-ctx-btn hr-ctx-del" title="열 삭제" onClick={deleteCol}>− 열</button>
          <button type="button" className="hr-ctx-btn table-ctx-btn" title="열 너비 균등" onClick={equalizeColWidths}>열↔</button>
        </div>
      )}
    </div>
  );
}

function EntryModal({ node, entryId, onClose, onSave, onDelete, nodePath, obsidianVault, allNodes, onWikiLink }: {
  node?: StudyNode;
  entryId?: string;
  onClose: () => void;
  onSave: (nodeId: string, entry: StudyEntry) => void;
  onDelete: (nodeId: string, entryId: string) => void;
  nodePath?: string;
  obsidianVault?: string;
  allNodes?: StudyNode[];
  onWikiLink?: (title: string) => void;
}) {
  const existing = node?.entries?.find((entry) => entry.id === entryId);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [body, setBody] = useState(existing?.body ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(existing?.attachments ?? []);
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tab, setTab] = useState<"content" | "files" | "links">("content");
  const [tagInput, setTagInput] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const allEntryTitles = useMemo(() => {
    if (!allNodes) return [];
    const titles: string[] = [];
    const collect = (ns: StudyNode[]) => ns.forEach(n => { n.entries?.forEach(e => { if (e.title !== title) titles.push(e.title); }); collect(n.children ?? []); });
    collect(allNodes);
    return titles;
  }, [allNodes, title]);

  if (!node) return null;

  const save = () => {
    if (!title.trim()) return;
    onSave(node.id, { id: existing?.id ?? id("e"), title: title.trim(), date, body, attachments, tags });
  };

  const handleExportMd = () => {
    exportNoteToMd(nodePath ?? node.name, {
      id: existing?.id ?? id("e"), title: title.trim() || "노트", date, body, attachments, tags
    });
  };

  const handleObsidian = () => {
    const params = new URLSearchParams({ name: title.trim() || "노트", content: body });
    if (obsidianVault) params.set('vault', obsidianVault);
    window.open(`obsidian://new?${params.toString()}`);
  };

  return (
    <div className="modal-overlay show">
      <div className="modal entry-modal">
        <div className="modal-head">
          <input className="modal-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="노트 제목을 입력하세요" />
          <input className="date-input entry-date-inline" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <IconButton label="닫기" onClick={onClose}>×</IconButton>
        </div>
        <div className="modal-sub">
          <span className="modal-sub-hint">{node.name}</span>
        </div>
        <div className="modal-tabs">
          <button className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}>📝 내용</button>
          <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>📎 파일 <span>{attachments.filter((a) => a.type !== "link").length || ""}</span></button>
          <button className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}>🔗 링크 <span>{attachments.filter((a) => a.type === "link").length || ""}</span></button>
        </div>
        <div className="modal-body md-editor-body">
          {tab === "content" && (
            <WysiwygEditor
              value={body}
              onChange={setBody}
              placeholder={"# 제목으로 구조를 잡아보세요\n\n내용을 바로 입력하면 서식이 적용됩니다\n툴바나 # 입력 후 Enter로 제목을 만들 수 있어요"}
              onWikiLink={onWikiLink}
              allEntryTitles={allEntryTitles}
            />
          )}
          {tab === "files" && (
            <div>
              <label className="file-drop">파일 이름으로 첨부 추가
                <input type="file" multiple hidden onChange={(e) => {
                  setAttachments((prev) => [...prev, ...Array.from(e.target.files ?? []).map((file) => ({ id: id("a"), name: file.name, type: file.type.startsWith("video") ? "video" as const : "doc" as const }))]);
                }} />
              </label>
              <AttachmentList attachments={attachments.filter((a) => a.type !== "link")} remove={(attachmentId) => setAttachments((prev) => prev.filter((item) => item.id !== attachmentId))} />
            </div>
          )}
          {tab === "links" && (
            <div>
              <div className="link-add">
                <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="이름" />
                <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
                <button onClick={() => {
                  if (!linkUrl.trim()) return;
                  setAttachments((prev) => [...prev, { id: id("a"), type: "link", name: linkName || linkUrl, url: linkUrl }]);
                  setLinkName("");
                  setLinkUrl("");
                }}>추가</button>
              </div>
              <AttachmentList attachments={attachments.filter((a) => a.type === "link")} remove={(attachmentId) => setAttachments((prev) => prev.filter((item) => item.id !== attachmentId))} />
            </div>
          )}
        </div>
        <div className="modal-tags">
          <span>🏷️ 태그</span>
          <div className="tag-chips">{tags.map((tag) => <button key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))}>#{tag} ×</button>)}</div>
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              const next = tagInput.trim().replace(/^#/, "");
              if (next && !tags.includes(next)) setTags([...tags, next]);
              setTagInput("");
            }
          }} placeholder="태그 입력 후 Enter" />
        </div>
        <div className="modal-foot entry-foot">
          <div className="entry-foot-left">
            {existing && <button className="btn-text danger" onClick={() => onDelete(node.id, existing.id)}>🗑️ 삭제</button>}
            <button type="button" className="btn-text export-md-btn" title="마크다운 파일로 내보내기" onClick={handleExportMd}>⬇ .md</button>
            <button type="button" className="btn-text obsidian-btn" title="Obsidian으로 열기" onClick={handleObsidian}>🟣 Obsidian</button>
          </div>
          <div className="modal-actions">
            <button className="btn-text" onClick={onClose}>취소</button>
            <button className="btn btn-primary" onClick={save}>저장 ✓</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentList({ attachments, remove }: { attachments: Attachment[]; remove: (id: string) => void }) {
  return (
    <div className="file-list">
      {attachments.length ? attachments.map((item) => (
        <div className="file-item" key={item.id}><span>{item.type === "video" ? "🎬" : item.type === "link" ? "🔗" : "📄"}</span><b>{item.name}</b><button onClick={() => remove(item.id)}>×</button></div>
      )) : <p className="tab-empty">아직 추가한 항목이 없어요</p>}
    </div>
  );
}

function CategoryModal({ leaf, emoji, parentName, onEmojiPick, onClose, onSave }: {
  leaf: boolean;
  emoji: string;
  parentName?: string;
  onEmojiPick: (emoji: string) => void;
  onClose: () => void;
  onSave: (name: string, initialEntry?: StudyEntry) => void;
}) {
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [entryBody, setEntryBody] = useState("- ");
  const [entryTags, setEntryTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const save = () => {
    const initialEntry = leaf && entryTitle.trim()
      ? {
          id: id("e"),
          title: entryTitle.trim(),
          date: entryDate || todayISO(),
          body: entryBody.trim(),
          attachments: [],
          tags: [...entryTags],
        }
      : undefined;
    onSave(name, initialEntry);
  };
  return (
    <div className="modal-overlay show category-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal category-modal ${leaf ? "category-modal-leaf" : ""}`}>
        <div className="category-input-wrap">
          <button
            className={`category-emoji-preview ${emojiOpen ? "active" : ""}`}
            type="button"
            onClick={() => setEmojiOpen((value) => !value)}
          >
            <span>{emoji}</span>
            <b>이모지 고르기</b>
          </button>
          <label className={`category-name-field ${focused ? "active" : ""}`}>
            <span className="category-field-label">{"폴더 이름"}</span>
            <input
              value={name}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !leaf) save();
              }}
              placeholder={leaf ? "예: 개념정리" : "예: 영어"}
              autoFocus
            />
          </label>
        </div>
        {emojiOpen && (
          <>
            <div className="emoji-section-label">이모지 선택</div>
            <div className="mini-emoji-grid">
              {emojis.map((item) => (
                <button
                  className={item === emoji ? "active" : ""}
                  key={item}
                  onClick={() => {
                    onEmojiPick(item);
                    setEmojiOpen(false);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        )}
        {leaf && (
          <div className="category-entry-fields">
            <div className="modal-sub category-entry-sub">
              <input className="modal-title-input" value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="첫 노트 제목을 적어주세요" />
              <input className="date-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="modal-tabs">
              <button className="active">📝 내용</button>
              <button disabled>📎 파일</button>
              <button disabled>🔗 링크</button>
            </div>
            <div className="modal-body">
              <textarea value={entryBody} onChange={(e) => setEntryBody(e.target.value)} placeholder="배운 내용을 자유롭게 적어보세요. 줄 앞에 '- '를 붙이면 목록이 돼요." />
            </div>
            <div className="modal-tags">
              <span>🏷️ 태그</span>
              <div className="tag-chips">{entryTags.map((tag) => <button key={tag} onClick={() => setEntryTags(entryTags.filter((item) => item !== tag))}>#{tag} ×</button>)}</div>
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const next = tagInput.trim().replace(/^#/, "");
                  if (next && !entryTags.includes(next)) setEntryTags([...entryTags, next]);
                  setTagInput("");
                }
              }} placeholder="태그 입력 후 Enter" />
            </div>
          </div>
        )}
        <p className="modal-hint">{parentName ? `${parentName} 아래에 추가합니다` : "새 최상위 폴더를 추가합니다"}</p>
        <div className="modal-foot">
          <div />
          <button className="btn-text" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={save}>추가</button>
        </div>
      </div>
    </div>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="modal-overlay show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="emoji-picker show">
        <div className="ep-title">이모지 고르기</div>
        <div className="ep-grid">
          {emojis.map((emoji) => <button key={emoji} onClick={() => onPick(emoji)}>{emoji}</button>)}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, setSettings, onClose }: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onClose: () => void;
}) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  return (
    <div className="settings-overlay show">
      <div className="settings-scrim" onClick={onClose} />
      <aside className="settings-panel">
        <div className="sp-head"><h2>⚙️ 설정</h2><IconButton label="닫기" onClick={onClose}>×</IconButton></div>
        <div className="sp-body">
          <section className="sp-section">
            <h3>글꼴</h3>
            <label>전체 폰트<select value={settings.font} onChange={(e) => update("font", e.target.value as FontName)}><option value="pretendard">Pretendard</option><option value="jua">Jua</option><option value="system">시스템</option></select></label>
            <Range label="네비게이션 크기" value={settings.navSize} min={12} max={22} onChange={(value) => update("navSize", value)} />
            <Range label="본문 크기" value={settings.bodySize} min={12} max={20} onChange={(value) => update("bodySize", value)} />
            <Range label="제목 크기" value={settings.titleSize} min={20} max={40} onChange={(value) => update("titleSize", value)} />
          </section>
          <section className="sp-section">
            <h3>스킨</h3>
            <p className="sp-skin-hint">색·폰트·모서리·효과까지 통째로 바뀌어요. 드래그·클릭 때 터지는 손맛도 스킨마다 달라요 ✨</p>
            <div className="skin-grid">
              {([
                ["monggle",    "몽글",     "💜", "linear-gradient(135deg,#c4b5fd,#f0abfc)"],
                ["minimal",    "미니멀",   "▫️", "linear-gradient(135deg,#f4f4f5,#6366f1)"],
                ["retro",      "레트로",   "👾", "linear-gradient(135deg,#ff5277,#ffd23f)"],
                ["neon",       "네온",     "🌃", "linear-gradient(135deg,#22d3ee,#d946ef)"],
                ["paper",      "종이",     "📒", "linear-gradient(135deg,#f0e6d0,#c08552)"],
                ["jelly",      "젤리",     "🍬", "linear-gradient(135deg,#fbcfe8,#f472b6)"],
                ["glass",      "글래스",   "🫧", "linear-gradient(135deg,#a5f3fc,#818cf8)"],
                ["galaxy",     "갤럭시",   "🌌", "linear-gradient(135deg,#312e81,#a855f7)"],
                ["terminal",   "터미널",   "🖥️", "linear-gradient(135deg,#022c22,#39ff14)"],
                ["watercolor", "수채화",   "🎨", "linear-gradient(135deg,#bbf7d0,#7dd3fc)"],
              ] as [SkinName, string, string, string][]).map(([s, label, emoji, swatch]) => (
                <button
                  className={`skin-btn ${settings.skin === s ? "active" : ""}`}
                  key={s}
                  onClick={(e) => { update("skin", s); burst(e.clientX, e.clientY); }}
                >
                  <span className="skin-swatch" style={{ background: swatch }}>{emoji}</span>
                  {label}
                </button>
              ))}
            </div>
          </section>
          {settings.skin === "monggle" && (
          <section className="sp-section">
            <h3>테마 & 색상</h3>
            <div className="sp-theme-group">
              <span className="sp-mode-label">☀️ 라이트</span>
              <div className="theme-grid">
                {([
                  ["lavender", "라벤더", "#a78bfa"],
                  ["ocean",    "오션",   "#60a5fa"],
                  ["forest",   "포레스트","#34d399"],
                  ["sunset",   "선셋",   "#fb923c"],
                  ["rose",     "로즈",   "#f472b6"],
                ] as [ThemeName, string, string][]).map(([t, label, color]) => (
                  <button
                    className={`theme-btn ${settings.theme === t ? "active" : ""}`}
                    key={t}
                    onClick={() => update("theme", t)}
                  >
                    <span className="theme-dot" style={{ background: color }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sp-theme-group">
              <span className="sp-mode-label">🌙 다크</span>
              <div className="theme-grid">
                {([
                  ["dark",        "퍼플",   "#a78bfa"],
                  ["dark-ocean",  "오션",   "#60a5fa"],
                  ["dark-forest", "포레스트","#34d399"],
                  ["dark-warm",   "웜",     "#fb923c"],
                ] as [ThemeName, string, string][]).map(([t, label, color]) => (
                  <button
                    className={`theme-btn ${settings.theme === t ? "active" : ""}`}
                    key={t}
                    onClick={() => update("theme", t)}
                  >
                    <span className="theme-dot" style={{ background: color }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
          )}
          <section className="sp-section">
            <h3>레이아웃</h3>
            <Range label="사이드바 기본 폭" value={settings.sidebarWidth} min={200} max={600} step={10} onChange={(value) => update("sidebarWidth", value)} />
          </section>
          <section className="sp-section">
            <h3>🟣 Obsidian 연동</h3>
            <label className="sp-vault-label">
              볼트(Vault) 이름
              <input
                type="text"
                className="sp-vault-input"
                value={settings.obsidianVault}
                onChange={(e) => update("obsidianVault", e.target.value)}
                placeholder="예: My Vault (비워두면 기본 볼트)"
              />
            </label>
            <p className="sp-vault-hint">노트 편집 창의 '🟣 Obsidian' 버튼이 이 볼트로 연결됩니다</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} /><span>{value}px</span></label>;
}

function EmptyState({ title = "왼쪽에서 카테고리를 골라보세요", body = "가장 깊은 소분류를 누르면 그날그날의 공부 기록을 남길 수 있어요", emoji = "👋" }) {
  return <div className="empty"><div className="big">{emoji}</div><h3>{title}</h3><p>{body}</p></div>;
}

function Mascot({ message, onClick }: { message: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <div className="mascot">
      <div className={`bubble ${message ? "show" : ""}`}>{message}</div>
      <button className="mochi-btn" onClick={onClick}><MochiLogo /></button>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-btn" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function MochiLogo() {
  return (
    <svg className="logo" viewBox="0 0 80 80" aria-hidden="true">
      <ellipse cx="40" cy="74" rx="20" ry="4" fill="oklch(64% 0.15 300 / .15)" />
      <path d="M18 46 q-4 -30 22 -30 q26 0 22 30 q2 16 -22 16 q-24 0 -22 -16z" fill="oklch(96% 0.05 300)" stroke="oklch(64% 0.15 300)" strokeWidth="2" />
      <circle cx="31" cy="42" r="3" fill="oklch(38% 0.05 300)" />
      <circle cx="49" cy="42" r="3" fill="oklch(38% 0.05 300)" />
      <circle cx="26" cy="48" r="3" fill="oklch(82% 0.09 55)" opacity=".7" />
      <circle cx="54" cy="48" r="3" fill="oklch(82% 0.09 55)" opacity=".7" />
      <path d="M35 49 q5 4 10 0" stroke="oklch(64% 0.15 300)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M40 16 q2 -7 8 -8 q-3 5 -2 9z" fill="oklch(78% 0.11 165)" />
    </svg>
  );
}

export default App;
