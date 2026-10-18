"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Clock, Eye } from "lucide-react";
import { Avatar, useDesignSystem } from "@/design-system";
import {
  QUESTION_LABELS, columnLabel, definitionToGraph, nodeOrder, roleName, type AnswerOptions, type BandNodeData, type BranchNodeData,
  type FlowDefinition, type GraphNode, type RoleOption, type StepNodeData,
} from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { BranchIcon, CHECK_ICONS } from "./flow-icons";
import { answerLabel, deadlineText, doneWhen } from "./flow-text";
import styles from "./flows.module.css";

/** What the cards need to draw themselves in plain words. */
type CanvasContext = { roles: RoleOption[]; columnNames: Record<string, string>; answerOptions: AnswerOptions; problems: Set<string> };
const CanvasContext = createContext<CanvasContext>({ roles: [], columnNames: {}, answerOptions: {}, problems: new Set() });

export const COMPONENT_MIME = "application/x-wodana-flow-component";

type CanvasNode = Node<StepNodeData | BranchNodeData | BandNodeData>;

const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const t = useT();
  const { roles, problems } = useContext(CanvasContext);
  const { direction } = useDesignSystem();
  const { step } = data;
  const Icon = CHECK_ICONS[step.check];
  const who = roleName(step.role, roles);
  const deadline = deadlineText(step.deadline, t);
  return <div className={styles.stepCard} dir={direction} data-problem={problems.has(step.key) || undefined} data-selected={selected || undefined}>
    <Handle className={styles.handle} isConnectable={false} position={Position.Top} type="target" />
    <div className={styles.cardHead}>
      <span aria-hidden="true" className={styles.cardIcon}><Icon size={15} /></span>
      <strong className={styles.cardName}>{step.name}</strong>
      {step.clientVisible ? <Eye aria-label={t("Client sees it")} className={styles.cardEye} role="img" size={15} /> : null}
    </div>
    <div className={styles.cardWho}><Avatar name={who} roles={[step.role]} seed={step.role} size="sm" /><span>{who}</span></div>
    <p className={styles.cardDone}>{doneWhen(step, t)}</p>
    {deadline || step.optional ? <div className={styles.cardMeta}>
      {deadline ? <span className={styles.chip}><Clock aria-hidden="true" size={12} />{deadline}</span> : null}
      {step.optional ? <span className={styles.chip} data-tone="muted">{t("Optional")}</span> : null}
    </div> : null}
    <Handle className={styles.handle} isConnectable={false} position={Position.Bottom} type="source" />
  </div>;
});

const BranchNode = memo(function BranchNode({ data, selected }: NodeProps<Node<BranchNodeData>>) {
  const t = useT();
  const { answerOptions, problems } = useContext(CanvasContext);
  const { direction } = useDesignSystem();
  // React Flow lays its canvas out left to right; each card reads in the page's own direction.
  return <div className={styles.branchCard} dir={direction} data-problem={problems.has(data.branch.key) || undefined} data-selected={selected || undefined}>
    <Handle className={styles.handle} isConnectable={false} position={Position.Top} type="target" />
    <div className={styles.cardHead}>
      <span aria-hidden="true" className={styles.cardIcon} data-tone="logic"><BranchIcon size={15} /></span>
      <strong className={styles.cardName}>{t(QUESTION_LABELS[data.branch.question])}</strong>
    </div>
    <div className={styles.answers}>
      {data.answers.length ? data.answers.map((value) => {
        const answer = answerLabel(data.branch.question, value, answerOptions, t);
        return <span className={styles.answer} key={value}>
          {answer.letter ? <b>{answer.letter}</b> : null}<span>{answer.label}</span>
          <Handle className={styles.answerHandle} id={value} isConnectable={false} position={Position.Bottom} type="source" />
        </span>;
      }) : <span className={styles.muted}>{t("No answers yet")}</span>}
    </div>
    {!data.answers.length ? <Handle className={styles.handle} isConnectable={false} position={Position.Bottom} type="source" /> : null}
  </div>;
});

/** The steps in a band are what moves a job into that column, so the band says so. */
const BandNode = memo(function BandNode({ data }: NodeProps<Node<BandNodeData>>) {
  const t = useT();
  const { columnNames } = useContext(CanvasContext);
  const { direction } = useDesignSystem();
  return <div className={styles.band} dir={direction}>
    <span className={styles.bandLabel}>{t("Moves to {column}", { column: columnLabel(data.column, columnNames) })}</span>
  </div>;
});

const nodeTypes = { step: StepNode, branch: BranchNode, band: BandNode };

/** The node id under the keyboard focus or the pointer, if it is a card. */
const cardId = (target: EventTarget | null) => {
  const id = (target as HTMLElement | null)?.closest?.(".react-flow__node")?.getAttribute("data-id");
  return id && !id.startsWith("band:") ? id : null;
};

/**
 * The centre canvas (plan §5a): the flow top to bottom, columns as soft bands, branches as labelled forks. Cards
 * are focusable; arrows move the selection, Delete removes it. A component dropped on the canvas goes after the
 * card above the drop point.
 */
export function FlowCanvas({ answerOptions, columnNames, definition, focusId, onDrop, onRemove, onSelect, problems, readOnly = false, roles, selectedId }: {
  answerOptions: AnswerOptions; columnNames: Record<string, string>; definition: FlowDefinition; focusId: { id: string; at: number } | null;
  onDrop?: (component: string, afterId: string | null) => void; onRemove?: (id: string) => void; onSelect: (id: string | null) => void;
  problems: Set<string>; readOnly?: boolean; roles: RoleOption[]; selectedId: string | null;
}) {
  const t = useT();
  const { direction } = useDesignSystem();
  const flow = useReactFlow<CanvasNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  // Cards grow with their text: once measured, the layout spaces them by their real heights.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const graph = useMemo(() => definitionToGraph(definition, { rtl: direction === "rtl", heights }), [definition, direction, heights]);
  const measured = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const sizes = changes.flatMap((change) => change.type === "dimensions" && change.dimensions && !change.id.startsWith("band:") ? [[change.id, Math.ceil(change.dimensions.height)] as const] : []);
    if (sizes.length) setHeights((current) => sizes.some(([id, height]) => current[id] !== height) ? { ...current, ...Object.fromEntries(sizes) } : current);
  }, []);
  const nodes = useMemo<CanvasNode[]>(() => graph.nodes.map((node) => ({
    id: node.id, type: node.type, position: node.position, data: node.data, width: node.width, height: node.type === "band" ? node.height : undefined,
    selected: node.id === selectedId, draggable: false, connectable: false,
    ...(node.type === "band" ? { selectable: false, focusable: false, zIndex: -1, style: { width: node.width, height: node.height } } : { ariaLabel: ariaFor(node) }),
  })), [graph, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, type: "smoothstep",
    className: styles.edge, focusable: false, selectable: false, zIndex: 1,
  })), [graph]);
  const context = useMemo(() => ({ roles, columnNames, answerOptions, problems }), [roles, columnNames, answerOptions, problems]);

  function ariaFor(node: GraphNode) {
    if (node.data.kind === "step") return t("Step: {name}", { name: node.data.step.name });
    if (node.data.kind === "branch") return t("Branch: {question}", { question: t(QUESTION_LABELS[node.data.branch.question]) });
    return undefined;
  }

  // Bring a card into view and give it the keyboard focus (after a keyboard move, an add or a problem click).
  useEffect(() => {
    if (!focusId) return;
    const node = flow.getNode(focusId.id);
    if (!node) return;
    const zoom = flow.getZoom();
    void flow.fitView({ nodes: [{ id: focusId.id }], duration: 200, minZoom: zoom, maxZoom: zoom });
    window.requestAnimationFrame(() => wrapper.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(focusId.id)}"]`)?.focus());
  }, [focusId, flow]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const id = cardId(event.target);
    if (!id) return;
    const order = nodeOrder(definition);
    const index = order.indexOf(id);
    const move = (next: string | undefined) => {
      if (!next) return;
      event.preventDefault();
      onSelect(next);
      wrapper.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(next)}"]`)?.focus();
      const zoom = flow.getZoom();
      void flow.fitView({ nodes: [{ id: next }], duration: 150, minZoom: zoom, maxZoom: zoom });
    };
    if (event.key === "ArrowDown" || event.key === (direction === "rtl" ? "ArrowLeft" : "ArrowRight")) move(order[index + 1]);
    else if (event.key === "ArrowUp" || event.key === (direction === "rtl" ? "ArrowRight" : "ArrowLeft")) move(order[index - 1]);
    else if ((event.key === "Delete" || event.key === "Backspace") && !readOnly) { event.preventDefault(); onRemove?.(id); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); }
    else if (event.key === "Escape") onSelect(null);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    const component = event.dataTransfer.getData(COMPONENT_MIME);
    if (!component || readOnly) return;
    event.preventDefault();
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // After the card whose top is closest above the drop point (favouring the lane under the pointer).
    const above = graph.nodes.filter((node) => node.type !== "band" && node.position.y <= point.y)
      .sort((a, b) => (point.y - a.position.y + Math.abs(point.x - a.position.x - a.width / 2) / 2) - (point.y - b.position.y + Math.abs(point.x - b.position.x - b.width / 2) / 2))[0];
    onDrop?.(component, above?.id ?? null);
  }

  return <CanvasContext.Provider value={context}>
    <div className={styles.canvas} onDragOver={(event) => { if (!readOnly && event.dataTransfer.types.includes(COMPONENT_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={drop} onFocusCapture={(event) => { const id = cardId(event.target); if (id && id !== selectedId) onSelect(id); }} onKeyDown={keyDown} ref={wrapper}>
      <ReactFlow<CanvasNode>
        deleteKeyCode={null} disableKeyboardA11y edges={edges} elementsSelectable onInit={(instance) => {
          // Start at the top of the line, as wide as fits (never larger than life), rather than squeezing a long flow.
          const box = wrapper.current?.getBoundingClientRect();
          const width = Math.max(...graph.nodes.map((node) => node.position.x + node.width)) - Math.min(...graph.nodes.map((node) => node.position.x));
          const left = Math.min(...graph.nodes.map((node) => node.position.x));
          if (!box || !Number.isFinite(width)) return;
          const zoom = Math.min(1, Math.max(0.4, (box.width - 48) / width));
          void instance.setViewport({ x: box.width / 2 - (left + width / 2) * zoom, y: 32 - Math.min(...graph.nodes.map((node) => node.position.y)) * zoom, zoom });
        }}
        maxZoom={1.6} minZoom={0.25} nodes={nodes} nodesConnectable={false} nodesDraggable={false} nodesFocusable nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => { if (node.type !== "band") onSelect(node.id); }} onNodesChange={measured} onPaneClick={() => onSelect(null)} panOnScroll
        selectionOnDrag={false} snapGrid={[16, 16]} snapToGrid zoomOnDoubleClick={false}>
        <Background className={styles.dots} gap={16} size={1} />
        <Controls className={styles.controls} position={direction === "rtl" ? "bottom-right" : "bottom-left"} showInteractive={false} />
      </ReactFlow>
    </div>
  </CanvasContext.Provider>;
}
