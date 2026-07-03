/**
 * Graph Architecture Core Types
 * Defines the structure for Multi-Input/Multi-Output Node Graph.
 */

export type DataType = 'image' | 'mask' | 'string' | 'number' | 'boolean' | 'model' | 'latents' | 'json' | 'any';

// --------------------------------------------------------
// 1. Registry Level (Definition) - What a node *can* do
// --------------------------------------------------------

export interface PortDefinition {
  name: string;        // Machine key (e.g., "base_image")
  label: string;       // UI Label (e.g., "Base Image")
  type: DataType;      // Validation type
  defaultValue?: unknown;  // Fallback if disconnected
  required?: boolean;  // Is connection/value mandatory?
  description?: string; // Tooltip info

  // UI Hint for when disconnected (e.g. show a slider if no input)
  uiWidget?: 'slider' | 'text' | 'number' | 'boolean' | 'color' | 'select' | 'file';
  uiOptions?: {
    min?: number;
    max?: number;
    step?: number;
    options?: string[]; // For select
    accept?: string;    // For file
  };
}

export interface NodeDefinition {
  id: string;               // Unique Identifier (e.g., "art.color_transfer")
  category: string;         // Grouping (e.g., "Filter")
  label: string;            // Display Name
  description: string;
  version: string;

  inputs: PortDefinition[];  // Defined ordered inputs (Left Side)
  outputs: PortDefinition[]; // Defined ordered outputs (Right Side)

  executable: boolean;      // Does it run on backend? (True for Art/plugins)
  width?: number;           // Default width
  height?: number;          // Default height
}

// --------------------------------------------------------
// 2. Instance Level (The Workflow) - The actual graph
// --------------------------------------------------------

export interface GraphNode {
  id: string;           // Instance UUID
  type: string;         // Reference to NodeDefinition.id
  label?: string;       // Custom alias (User renamed)
  position: { x: number; y: number };

  // Parameter Values (Internal State / Widgets)
  // Stores values for inputs that are NOT connected.
  // mapped by PortDefinition.name -> value
  data: Record<string, unknown>;

  // UI State
  ui?: {
    width?: number;
    height?: number;
    selected?: boolean;
    collapsed?: boolean;
    // For Hook specific visualization
    previewSrc?: string; // If node produces an image preview
    status?: 'idle' | 'running' | 'success' | 'error';
    progress?: number;
    errorMessage?: string;
  };
}

export interface GraphEdge {
  id: string;

  // Source (Output logic)
  sourceNodeId: string;
  sourceHandle: string; // matches NodeDefinition.outputs[i].name

  // Target (Input logic)
  targetNodeId: string;
  targetHandle: string; // matches NodeDefinition.inputs[i].name

  // Visuals
  type?: string;        // flow line style
  animated?: boolean;
  style?: Record<string, unknown>;
}

export interface GraphWorkflow {
  version: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport?: { x: number; y: number; zoom: number };
}
