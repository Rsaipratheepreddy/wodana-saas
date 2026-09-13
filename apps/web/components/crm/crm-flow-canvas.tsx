"use client";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps, type Edge } from "@xyflow/react";
import { GitBranch, Play, CircleCheck, Clock3, ClipboardCheck, UserRoundCheck, GripVertical, X, Trash2, Plus } from "lucide-react";
import { label } from "@/lib/crm/client";
import { connectFlow, createFlowStep, edgePort, flowPalette, flowPorts, type FlowDefinition, type FlowEdge, type FlowPoint, type FlowStep } from "@/lib/crm/flow-editor";
import "@xyflow/react/dist/style.css";
import styles from "./crm-flow-canvas.module.css";

type StepNode = Node<{ step: FlowStep; selected: boolean; ports: { id: string; label: string }[] }, "crmStep">;
type Props = { definition: FlowDefinition; selectedKey: string; onSelect: (key: string) => void; onChange: (next: FlowDefinition) => void; paletteOpen: boolean; onPaletteClose: () => void };
function StepIcon({ type }: { type: string }) {
  return type === "trigger" ? <Play size={16} /> : type === "end" ? <CircleCheck size={16} /> : type === "create_task" ? <ClipboardCheck size={16} /> : type === "delay_until" ? <Clock3 size={16} /> : type === "assign" ? <UserRoundCheck size={16} /> : <GitBranch size={16} />;
}
function CrmStep({ data }: NodeProps<StepNode>) {
  const { step, ports } = data;
  return <div className={styles.node} data-selected={data.selected} data-kind={step.type}>
    {step.type !== "trigger" ? <Handle type="target" position={Position.Top} aria-label={`Input for ${step.key}`} /> : null}
    <div className={styles.nodeBody}><span className={styles.icon}><StepIcon type={step.type} /></span><div><strong>{step.type === "filter" ? "Condition" : label(step.type)}</strong><small>{String(step.configuration.title ?? (step.type === "trigger" ? (step.configuration.eventTypes as string[] ?? []).join(", ") : step.type === "delay_until" ? `Wait ${step.configuration.delayMinutes ?? 0} minutes` : step.type === "filter" ? `${(step.configuration.condition as { path?: string })?.path ?? "Choose a field"}` : step.key))}</small></div></div>
    {ports.length ? <div className={styles.ports}>{ports.map((port, index) => <span key={port.id}>{port.label}<Handle id={port.id} type="source" position={Position.Bottom} style={{ left: `${(index + .5) * 100 / ports.length}%` }} aria-label={`${port.label} output for ${step.key}`} /></span>)}</div> : null}
  </div>;
}
const nodeTypes = { crmStep: CrmStep };

export function CrmFlowCanvas(props: Props) {
  return <ReactFlowProvider><FlowCanvas {...props} /></ReactFlowProvider>;
}
function FlowCanvas({ definition, selectedKey, onSelect, onChange, paletteOpen, onPaletteClose }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow<StepNode>();
  const [positions, setPositions] = useState<Record<string, FlowPoint>>({});
  const [notice, setNotice] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);
  const [touchGhost, setTouchGhost] = useState<{ type: string; x: number; y: number } | null>(null);
  const touch = useRef<{ type: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const nodes = useMemo<StepNode[]>(() => {
    const depths = new Map<string, number>(), queue = definition.nodes.filter((step) => step.type === "trigger").map((step) => ({ key: step.key, depth: 0 }));
    while (queue.length) { const { key, depth } = queue.shift()!; if (depths.has(key)) continue; depths.set(key, depth); definition.edges.filter((edge) => edge.from === key).forEach((edge) => queue.push({ key: edge.to, depth: depth + 1 })); }
    const columns = new Map<number, number>();
    return definition.nodes.map((step, index) => {
      const depth = depths.get(step.key) ?? index, column = columns.get(depth) ?? 0; columns.set(depth, column + 1);
      const saved = step.position as { x?: number; y?: number } | undefined;
      const position = positions[step.key] ?? (Number.isFinite(saved?.x) && Number.isFinite(saved?.y) ? { x: saved!.x!, y: saved!.y! } : { x: column * 350, y: depth * 155 });
      return { id: step.key, type: "crmStep", position, selected: selectedKey === step.key, data: { step, selected: selectedKey === step.key, ports: flowPorts(definition, step) }, ariaLabel: `${label(step.type)}: ${String(step.configuration.title ?? step.key)}` };
    });
  }, [definition, positions, selectedKey]);
  const edges = useMemo<Edge[]>(() => definition.edges.map((edge, index) => ({ id: `edge-${index}`, source: edge.from, target: edge.to, sourceHandle: edgePort(definition, edge, index), type: "smoothstep", selected: selectedEdge === edge, reconnectable: "target", label: edge.default ? "Otherwise" : edge.when != null ? String(edge.when) === "true" ? "Yes" : String(edge.when) === "false" ? "No" : label(String(edge.when)) : edge.condition ? "Condition" : undefined, markerEnd: { type: MarkerType.ArrowClosed } })), [definition, selectedEdge]);

  function commit(next: FlowDefinition) { setPositions({}); setSelectedEdge(null); onChange(next); }
  function add(type: string, point?: FlowPoint) {
    if (definition.nodes.length >= 200) { setNotice("A workflow can contain at most 200 steps."); return; }
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    const screenPoint = point ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const position = screenToFlowPosition(screenPoint);
    const key = `step_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const step = createFlowStep(type, key, { x: position.x - 140, y: position.y - 40 });
    if (!step) return;
    commit({ ...definition, nodes: [...definition.nodes, step] }); onSelect(key);
    setNotice(`${flowPalette.find((item) => item.type === type)?.title} added. Connect its input and outputs before saving.`);
    if (rect.width < 768) onPaletteClose();
  }
  function connect(source: string | null, target: string | null, port?: string | null) {
    const result = connectFlow(definition, source ?? "", target ?? "", port ?? "next");
    if (result.error) { setNotice(result.error); return; }
    commit(result.definition); setNotice("Connection updated. Undo is available; nothing runs until you save and publish.");
  }
  function finishTouch(event: PointerEvent<HTMLButtonElement>) {
    const state = touch.current; touch.current = null; setTouchGhost(null);
    if (!state?.moved) return;
    suppressClick.current = true;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit?.closest(".react-flow")) add(state.type, { x: event.clientX, y: event.clientY });
    else setNotice("Drop the step onto the canvas.");
  }
  return <div className={styles.canvas} ref={wrapper} aria-label="Automation flow canvas">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .3, maxZoom: 1 }} minZoom={.25} maxZoom={1.8} deleteKeyCode={null} nodesFocusable edgesFocusable
      onNodeClick={(_event, node) => { setSelectedEdge(null); onSelect(node.id); }}
      onPaneClick={() => { setSelectedEdge(null); onSelect(""); }}
      onEdgeClick={(_event, edge) => { setSelectedEdge(definition.edges[Number(edge.id.slice(5))] ?? null); onSelect(""); }}
      onNodesChange={(changes) => {
        const moved = changes.filter((change) => change.type === "position" && change.position);
        if (!moved.length) return;
        setPositions((old) => { const next = { ...old }; for (const change of moved) if (change.type === "position" && change.position) next[change.id] = change.position; return next; });
        // Keyboard movement also persists, without recording every mouse-drag frame.
        if (moved.every((change) => change.type === "position" && !change.dragging)) {
          onChange({ ...definition, nodes: definition.nodes.map((step) => { const change = moved.find((value) => value.type === "position" && value.id === step.key); return change?.type === "position" && change.position ? { ...step, position: change.position } : step; }) });
          setPositions({});
        }
      }}
      onConnect={(connection) => connect(connection.source, connection.target, connection.sourceHandle)}
      onReconnect={(edge, connection) => connect(edge.source, connection.target, edge.sourceHandle)}
      isValidConnection={(connection) => !connectFlow(definition, connection.source ?? "", connection.target ?? "", connection.sourceHandle ?? "next").error}
      onConnectEnd={(_event, state) => { if (state.toNode && !state.isValid) setNotice("Invalid connection: use a valid output and avoid self-links or loops."); }}
      onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("application/wodana-crm-step")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => { const type = event.dataTransfer.getData("application/wodana-crm-step"); if (!type) return; event.preventDefault(); add(type, { x: event.clientX, y: event.clientY }); }}>
      <Background color="var(--wd-color-structural-divider)" gap={22} size={1} /><Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
    {paletteOpen ? <aside className={styles.palette} aria-label="Add automation steps">
      <header><strong>Add steps</strong><button type="button" aria-label="Close step palette" onClick={onPaletteClose}><X size={15} /></button></header>
      <p>Drag a step onto the canvas, or tap to add.</p>
      {flowPalette.map((item) => <button type="button" className={styles.paletteStep} key={item.type} draggable aria-label={`Add ${item.title}`}
        onDragStart={(event) => { event.dataTransfer.setData("application/wodana-crm-step", item.type); event.dataTransfer.effectAllowed = "copy"; }}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } add(item.type); }}
        onPointerDown={(event) => { suppressClick.current = false; if (event.pointerType === "touch") { touch.current = { type: item.type, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={(event) => { if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 6) { touch.current.moved = true; setTouchGhost({ type: item.type, x: event.clientX, y: event.clientY }); } }}
        onPointerUp={finishTouch} onPointerCancel={() => { touch.current = null; setTouchGhost(null); }}>
        <span className={styles.icon}><StepIcon type={item.type} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><GripVertical size={13} />
      </button>)}
      <small><Play size={11} /> One trigger starts the flow. Edit its event on the canvas.</small>
    </aside> : <button type="button" className={styles.addHint} onClick={() => add("create_task")}><Plus size={14} /> Add task</button>}
    {selectedEdge && definition.edges.includes(selectedEdge) ? <div className={styles.edgeTools}><span>Selected connection</span><button type="button" onClick={() => { commit({ ...definition, edges: definition.edges.filter((edge) => edge !== selectedEdge) }); setNotice("Connection removed from the draft. Undo restores it."); }}><Trash2 size={13} /> Remove connection</button></div> : null}
    <div className={styles.hint} role="status">{notice || "Drag steps · Connect the dots · Click a step to configure"}</div>
    {touchGhost ? <div className={styles.dragGhost} style={{ left: touchGhost.x + 12, top: touchGhost.y + 12 }}><StepIcon type={touchGhost.type} />{flowPalette.find((item) => item.type === touchGhost.type)?.title}</div> : null}
  </div>;
}
