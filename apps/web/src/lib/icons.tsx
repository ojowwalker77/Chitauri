import { type CSSProperties, type FC, type SVGProps } from "react";
import {
  AdjustmentsHorizontalIcon as HeroAdjustmentsHorizontalIcon,
  ArchiveBoxIcon as HeroArchiveBoxIcon,
  ArrowDownIcon as HeroArrowDownIcon,
  ArrowDownTrayIcon as HeroArrowDownTrayIcon,
  ArrowLeftIcon as HeroArrowLeftIcon,
  ArrowPathIcon as HeroArrowPathIcon,
  ArrowRightIcon as HeroArrowRightIcon,
  ArrowTopRightOnSquareIcon as HeroArrowTopRightOnSquareIcon,
  ArrowUpIcon as HeroArrowUpIcon,
  ArrowUpRightIcon as HeroArrowUpRightIcon,
  ArrowUturnDownIcon as HeroArrowUturnDownIcon,
  ArrowUturnLeftIcon as HeroArrowUturnLeftIcon,
  ArrowsPointingInIcon as HeroArrowsPointingInIcon,
  ArrowsPointingOutIcon as HeroArrowsPointingOutIcon,
  ArrowsUpDownIcon as HeroArrowsUpDownIcon,
  Bars3Icon as HeroBars3Icon,
  BeakerIcon as HeroBeakerIcon,
  BellIcon as HeroBellIcon,
  BoltIcon as HeroBoltIcon,
  BookOpenIcon as HeroBookOpenIcon,
  BugAntIcon as HeroBugAntIcon,
  CameraIcon as HeroCameraIcon,
  ChartBarIcon as HeroChartBarIcon,
  ChatBubbleOvalLeftIcon as HeroChatBubbleOvalLeftIcon,
  CheckCircleIcon as HeroCheckCircleIcon,
  CheckIcon as HeroCheckIcon,
  ChevronDownIcon as HeroChevronDownIcon,
  ChevronLeftIcon as HeroChevronLeftIcon,
  ChevronRightIcon as HeroChevronRightIcon,
  ChevronUpDownIcon as HeroChevronUpDownIcon,
  ChevronUpIcon as HeroChevronUpIcon,
  ClipboardDocumentCheckIcon as HeroClipboardDocumentCheckIcon,
  ClockIcon as HeroClockIcon,
  Cog6ToothIcon as HeroCog6ToothIcon,
  ComputerDesktopIcon as HeroComputerDesktopIcon,
  CpuChipIcon as HeroCpuChipIcon,
  DocumentIcon as HeroDocumentIcon,
  EllipsisHorizontalIcon as HeroEllipsisHorizontalIcon,
  ExclamationCircleIcon as HeroExclamationCircleIcon,
  ExclamationTriangleIcon as HeroExclamationTriangleIcon,
  EyeIcon as HeroEyeIcon,
  FireIcon as HeroFireIcon,
  FlagIcon as HeroFlagIcon,
  FolderIcon as HeroFolderIcon,
  FolderOpenIcon as HeroFolderOpenIcon,
  GlobeAltIcon as HeroGlobeAltIcon,
  HashtagIcon as HeroHashtagIcon,
  InboxIcon as HeroInboxIcon,
  InformationCircleIcon as HeroInformationCircleIcon,
  ListBulletIcon as HeroListBulletIcon,
  LockClosedIcon as HeroLockClosedIcon,
  LockOpenIcon as HeroLockOpenIcon,
  MinusIcon as HeroMinusIcon,
  MicrophoneIcon as HeroMicrophoneIcon,
  MoonIcon as HeroMoonIcon,
  PaperClipIcon as HeroPaperClipIcon,
  PlayIcon as HeroPlayIcon,
  PlusIcon as HeroPlusIcon,
  RocketLaunchIcon as HeroRocketLaunchIcon,
  ShareIcon as HeroShareIcon,
  SparklesIcon as HeroSparklesIcon,
  StarIcon as HeroStarIcon,
  StopIcon as HeroStopIcon,
  SunIcon as HeroSunIcon,
  SwatchIcon as HeroSwatchIcon,
  TrashIcon as HeroTrashIcon,
  TrophyIcon as HeroTrophyIcon,
  ViewColumnsIcon as HeroViewColumnsIcon,
  XMarkIcon as HeroXMarkIcon,
  Squares2X2Icon as HeroSquares2X2Icon,
  Bars2Icon as HeroBars2Icon,
  ArrowUturnUpIcon as HeroArrowUturnUpIcon,
  FolderPlusIcon as HeroFolderPlusIcon,
  FunnelIcon as HeroFunnelIcon,
} from "@heroicons/react/24/outline";
import {
  StarIcon as HeroSolidStarIcon,
  StopIcon as HeroSolidStopIcon,
} from "@heroicons/react/24/solid";
// Brand marks only. Heroicons ships no logos, so product marks (GitHub, MCP)
// come from the brand sets — every other glyph in the app is a Heroicon or a
// Central asset. Do not reach for react-icons for a generic UI icon.
import { SiGithub } from "react-icons/si";
import { VscMcp } from "react-icons/vsc";
import { CentralIcon, type CentralIconVariant } from "./central-icons";

// Keep the existing icon API stable across icon-set migrations.
export type LucideIcon = FC<SVGProps<SVGSVGElement>>;

function heroIcon(Component: FC<SVGProps<SVGSVGElement>>): LucideIcon {
  return function HeroIcon({ width, height, ...props }) {
    // Heroicons declare no intrinsic size, so an unsized call site would fall
    // back to the browser's 300x150 default for a viewBox-only <svg>. Pin 24
    // like the icons these replaced; a `size-*` class still wins, because CSS
    // beats SVG presentation attributes.
    const size = width ?? height ?? 24;
    return <Component width={size} height={size} {...props} />;
  };
}

// Wraps a Central icon asset behind the LucideIcon API. Rendering via CSS mask
// avoids stroke-on-stroke alpha summation that gave hand-drawn SVGs a
// "stamped twice" look on shared vertices (the previous PinIcon bug).
function centralIconWrapper(name: string, variant?: CentralIconVariant): LucideIcon {
  return function CentralIconWrapper({ className, style, ...rest }) {
    const ariaLabelRaw = (rest as { ["aria-label"]?: unknown })["aria-label"];
    const label = typeof ariaLabelRaw === "string" ? ariaLabelRaw : undefined;
    return (
      <CentralIcon
        name={name}
        variant={variant}
        className={typeof className === "string" ? className : undefined}
        style={style as CSSProperties | undefined}
        label={label}
      />
    );
  };
}

export const AppsIcon = heroIcon(HeroSquares2X2Icon);
export const QueueArrow: LucideIcon = centralIconWrapper("reading-list");
export const SteerIcon: LucideIcon = centralIconWrapper("arrow-corner-down-right");
export const ComposerSendArrowIcon: LucideIcon = centralIconWrapper("arrow-up");
export const HandoffIcon: LucideIcon = centralIconWrapper("arrow-left-right");
export const SkillCubeIcon: LucideIcon = centralIconWrapper("building-blocks");
export const NewThreadIcon: LucideIcon = centralIconWrapper("compose-pencil");
export const EraserIcon: LucideIcon = centralIconWrapper("eraser");
export const ArrowLeftIcon = heroIcon(HeroArrowLeftIcon);
export const BellIcon = heroIcon(HeroBellIcon);
export const ArrowRightIcon = heroIcon(HeroArrowRightIcon);
export const ArrowDownIcon = heroIcon(HeroArrowDownIcon);
export const ArrowUpIcon = heroIcon(HeroArrowUpIcon);
export const ArrowUpRightIcon = heroIcon(HeroArrowUpRightIcon);
export const ArrowUpDownIcon = heroIcon(HeroArrowsUpDownIcon);
// Single source for the robot/agent glyph. Sourced from the Central icon set so
// every robot affordance (reasoning rows, agent-task rows, agent mention chips,
// subagent menus, agent-activity headers) renders one identical icon. Use
// BotIcon in React; AGENT_ROBOT_ICON_NAME for imperative DOM via
// createCentralIconElement.
export const AGENT_ROBOT_ICON_NAME = "robot";
export const BotIcon: LucideIcon = centralIconWrapper(AGENT_ROBOT_ICON_NAME);
export const BugIcon = heroIcon(HeroBugAntIcon);
export const CameraIcon = heroIcon(HeroCameraIcon);
export const CheckIcon = heroIcon(HeroCheckIcon);
export const ChevronDownIcon = heroIcon(HeroChevronDownIcon);
export const ChevronLeftIcon = heroIcon(HeroChevronLeftIcon);
export const ChevronRightIcon = heroIcon(HeroChevronRightIcon);
export const ChevronUpIcon = heroIcon(HeroChevronUpIcon);
export const ChevronsUpDownIcon = heroIcon(HeroChevronUpDownIcon);
export const CircleAlertIcon = heroIcon(HeroExclamationCircleIcon);
export const CircleCheckIcon = heroIcon(HeroCheckCircleIcon);
// Completed/success status glyph sourced from the Central set so it sits in the
// same visual language as the other trailing thread-row icons (worktree, fork,
// pull-request) instead of the react-icons outline check it replaced.
export const CheckCircle2Icon: LucideIcon = centralIconWrapper("check-circle-2");
// User-input rows: a question-mark circle while the agent waits for an answer,
// and an up-arrow circle once the answer is submitted. Sourced from the Central
// set so they sit visually beside the other timeline glyphs (robot, search, …).
export const CircleQuestionIcon: LucideIcon = centralIconWrapper("circle-questionmark");
export const ArrowUpCircleIcon: LucideIcon = centralIconWrapper("arrow-up-circle");
export const CloudUploadIcon = centralIconWrapper("cloud-upload");
export const CloudSyncIcon = centralIconWrapper("cloud-sync");
export const Columns2Icon = heroIcon(HeroViewColumnsIcon);
export const ChangesIcon = centralIconWrapper("changes");
export const CopyIcon = centralIconWrapper("square-behind-square-6");
export const LinkIcon = centralIconWrapper("chain-link-3");
export const DiffIcon = centralIconWrapper("difference-modified");
export const DownloadIcon = heroIcon(HeroArrowDownTrayIcon);
export const FlameIcon = heroIcon(HeroFireIcon);
export const TrophyIcon = heroIcon(HeroTrophyIcon);
// The clock doubles as the automation glyph everywhere it appears (meta chip,
// Automations nav, slash command, created card, environment section), so it is
// sourced from the Central icon set rather than the Tabler stroke icon.
export const ClockIcon = centralIconWrapper("clock");
export const ChartBarIcon = heroIcon(HeroChartBarIcon);
export const ShareIcon = heroIcon(HeroShareIcon);
export const SparklesIcon = heroIcon(HeroSparklesIcon);
export const HashIcon = heroIcon(HeroHashtagIcon);
export const InboxIcon = heroIcon(HeroInboxIcon);
export const EllipsisIcon = heroIcon(HeroEllipsisHorizontalIcon);
export const ExternalLinkIcon = heroIcon(HeroArrowTopRightOnSquareIcon);
export const EyeIcon = heroIcon(HeroEyeIcon);
export const PaletteIcon = heroIcon(HeroSwatchIcon);
export const PaperclipIcon = heroIcon(HeroPaperClipIcon);
export const AdjustmentsIcon = heroIcon(HeroAdjustmentsHorizontalIcon);
export const ArchiveIcon = heroIcon(HeroArchiveBoxIcon);
export const BooksIcon = heroIcon(HeroBookOpenIcon);
export const BrainIcon = heroIcon(HeroCpuChipIcon);
export const FileIcon = heroIcon(HeroDocumentIcon);
export const FlagIcon = heroIcon(HeroFlagIcon);
export const FlaskConicalIcon = heroIcon(HeroBeakerIcon);
export const FolderClosedIcon = heroIcon(HeroFolderIcon);
export const FolderIcon = heroIcon(HeroFolderIcon);
export const FolderOpenIcon = heroIcon(HeroFolderOpenIcon);
export const FolderPlusIcon = heroIcon(HeroFolderPlusIcon);
export const FilterIcon = heroIcon(HeroFunnelIcon);
export const CornerLeftUpIcon = heroIcon(HeroArrowUturnUpIcon);
// Stacked "folders" glyph used as the single representation of a file tree /
// explorer surface (right-dock explorer, editor Files activity, diff file-tree
// toggle). Central "reversed" outline asset so it matches the rest of the chrome.
export const FoldersIcon: LucideIcon = centralIconWrapper("folders");
export const GitCommitIcon: LucideIcon = centralIconWrapper("commits");
export const GitBranchIcon: LucideIcon = centralIconWrapper("branch");
export const GitForkIcon = centralIconWrapper("fork");
export const GitMergeIcon: LucideIcon = centralIconWrapper("merged");
export const GitMergedSimpleIcon: LucideIcon = centralIconWrapper("merged-simple");
export const PushIcon: LucideIcon = centralIconWrapper("cloud-simple-upload");
export const GitHubIcon: LucideIcon = (props) => (
  <SiGithub className={props.className} style={props.style} />
);
export const GitPullRequestIcon = centralIconWrapper("pull-request");
export const GlobeIcon = heroIcon(HeroGlobeAltIcon);
export const WebSearchIcon: LucideIcon = centralIconWrapper("globe");
export const McpIcon: LucideIcon = (props) => (
  <VscMcp className={props.className} style={props.style} />
);
export const MicrophoneIcon = heroIcon(HeroMicrophoneIcon);
export const PluginIcon: LucideIcon = centralIconWrapper("puzzle");
// Single hammer/build glyph (tool-call rows, codex provider, "build" scripts).
// Sourced from the Central set so it matches the other work-row icons (pencil,
// terminal, skill cube) it sits beside, instead of the Tabler wrench it used to be.
export const HammerIcon: LucideIcon = centralIconWrapper("hammer");
export const HistoryIcon = heroIcon(HeroClockIcon);
export const InfoIcon = heroIcon(HeroInformationCircleIcon);
export const ListChecksIcon = heroIcon(HeroClipboardDocumentCheckIcon);
export const ListTodoIcon = heroIcon(HeroListBulletIcon);
export const Loader2Icon = heroIcon(HeroArrowPathIcon);
export const LoaderCircleIcon = heroIcon(HeroArrowPathIcon);
export const LoaderIcon = heroIcon(HeroArrowPathIcon);
export const LockIcon = heroIcon(HeroLockClosedIcon);
export const LockOpenIcon = heroIcon(HeroLockOpenIcon);
export const Maximize2 = heroIcon(HeroArrowsPointingOutIcon);
export const Minimize2 = heroIcon(HeroArrowsPointingInIcon);
export const MessageCircleIcon = heroIcon(HeroChatBubbleOvalLeftIcon);
export const MinusIcon = heroIcon(HeroMinusIcon);
export const ChatBubbleIcon: LucideIcon = centralIconWrapper("bubble-text");
export const MicIcon: LucideIcon = centralIconWrapper("microphone");
export const SidebarHiddenLeftWideIcon = centralIconWrapper("sidebar-hidden-left-wide");
export const SidebarHiddenRightWideIcon = centralIconWrapper("sidebar-hidden-right-wide");
export const PanelLeftCloseIcon = SidebarHiddenLeftWideIcon;
export const PanelLeftIcon = centralIconWrapper("sidebar-simple-left-wide");
export const PanelRightCloseIcon = SidebarHiddenRightWideIcon;
export const WindowIcon: LucideIcon = centralIconWrapper("window");
export const LayoutSidebarIcon: LucideIcon = centralIconWrapper("layout-sidebar");
export const PencilIcon: LucideIcon = centralIconWrapper("pencil");
export const PinIcon: LucideIcon = centralIconWrapper("pin");
// Solid pin from the fill set — used wherever a pin reflects "pinned" status
// (project + thread rows and their hover cards) rather than a neutral action.
export const PinFilledIcon: LucideIcon = centralIconWrapper("pin", "fill");
export const PlayIcon = heroIcon(HeroPlayIcon);
export const Plus = heroIcon(HeroPlusIcon);
export const PlusIcon = heroIcon(HeroPlusIcon);
export const RefreshCwIcon = heroIcon(HeroArrowPathIcon);
export const RocketIcon = heroIcon(HeroRocketLaunchIcon);
export const RotateCcwIcon = heroIcon(HeroArrowUturnLeftIcon);
export const Rows3Icon = heroIcon(HeroBars3Icon);
export const SearchIcon: LucideIcon = centralIconWrapper("magnifying-glass");
export const SettingsIcon = heroIcon(HeroCog6ToothIcon);
export const StarIcon = heroIcon(HeroStarIcon);
export const StarFilledIcon = heroIcon(HeroSolidStarIcon);
export const SunIcon = heroIcon(HeroSunIcon);
export const MoonIcon = heroIcon(HeroMoonIcon);
export const DeviceLaptopIcon = heroIcon(HeroComputerDesktopIcon);
export const StopIcon = heroIcon(HeroStopIcon);
export const StopFilledIcon = heroIcon(HeroSolidStopIcon);
export const SquareSplitHorizontal = heroIcon(HeroViewColumnsIcon);
export const SquareSplitVertical = heroIcon(HeroBars2Icon);
export const TerminalIcon = centralIconWrapper("console");
export const TerminalSquare = centralIconWrapper("console");
export const TerminalSquareIcon = centralIconWrapper("console");
export const TextWrapIcon = heroIcon(HeroArrowUturnDownIcon);
export const Trash2 = heroIcon(HeroTrashIcon);
export const TriangleAlertIcon = heroIcon(HeroExclamationTriangleIcon);
export const Undo2Icon = heroIcon(HeroArrowUturnLeftIcon);
export const WorktreeIcon = centralIconWrapper("arrow-split-right");
export const XIcon = heroIcon(HeroXMarkIcon);
export const ZapIcon = heroIcon(HeroBoltIcon);
// Single source for the fast-mode glyph. Every fast-mode affordance (composer
// trait badges, the Speed submenu, the /fast command) renders this one solid
// lightning bolt from the Central fill set instead of mixing Tabler/Ionicons bolts.
export const FastModeIcon: LucideIcon = centralIconWrapper("zap", "fill");
