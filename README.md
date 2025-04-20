# Obsidian Juggl Group plugin

This plugin enhances the [Juggl](https://juggl.io/) graph view in Obsidian by automatically creating compound nodes based on a `parent` property in your note's frontmatter. This allows for hierarchical structuring and visualization of your notes directly within the Juggl graph.

> [!WARNING]  
> This plugin is vibe-coded and may not work as expected. Use at your own risk.

<img width="428" alt="image" src="https://github.com/user-attachments/assets/bf9ad6b6-f802-4b5e-8e6a-2ab16cb6de1d" />

## Features

*   **Automatic Compound Nodes:** Notes with a `parent: [[Parent Note]]` link in their frontmatter will be visually nested inside the 'Parent Note' node in Juggl graphs.
*   **Placeholder Parents:** If the linked parent note doesn't exist, a placeholder parent node is created to maintain the structure.
*   **Depth Calculation:** Automatically calculates the nesting depth of each node.
*   **Custom Styling:** Provides CSS classes (`parent-node`, `structural-parent-edge`) and data attributes (`data(depth)`) for detailed styling via Juggl's custom CSS.

## Installation

```sh
cd ~/Documents/obsidian/[user]/.obsidian/plugins
git clone https://github.com/takahirom/obsidian-juggl-group-plugin
cd obsidian-juggl-group-plugin
npm run dev
```

Open Settings > Community plugins > Juggl Group and enable the plugin.

## Recommended CSS

Add the following styles to your Juggl custom CSS file (`.obsidian/plugins/juggl/graph.css`) to visually represent the hierarchy and hide redundant links. You can customize the colors and styles further.

```css
/* Base style for regular notes */
/* This provides a default appearance */
.note {
    shape: round-rectangle;
    background-color: #D4EDFE; /* Base color - can be overridden by depth or tags */
    width: 60px;
    height: 30px;
    text-valign: center;
    text-max-width: 55px;
    text-overflow-wrap: anywhere; /* Important for CJK text wrapping */
    border-width: 1px;
    border-color: #ccc;
}

/* --- Depth-Based Styling --- */
/* Style nodes based on their nesting depth, calculated by the plugin */
/* You can uncomment the background-color lines to color nodes by depth */

node[depth = 0] {
/* background-color: hsl(50, 80%, 88%); */ /* Light Yellow */
    border-color: hsl(50, 60%, 70%);
}

node[depth = 1] {
/* background-color: hsl(110, 60%, 90%); */ /* Light Green */
    border-color: hsl(110, 40%, 75%);
}

node[depth = 2] {
/* background-color: hsl(170, 65%, 90%); */ /* Light Cyan/Aqua */
    border-color: hsl(170, 45%, 75%);
}

node[depth = 3] {
/* background-color: hsl(210, 70%, 92%); */ /* Light Blue */
    border-color: hsl(210, 50%, 78%);
}

node[depth >= 4] {
/* background-color: hsl(270, 50%, 93%); */ /* Light Purple/Lavender */
    border-color: hsl(270, 30%, 80%);
}

/* Alternative: Use mapData for a continuous color gradient based on depth */
/* Comment out the specific node[depth = X] rules above if using this */
/*
node[depth >= 0] {
    background-color: mapData(depth, 0, 5, hsl(60, 80%, 88%), hsl(240, 60%, 88%)); /* Yellow to Blue gradient */
/*    border-color: mapData(depth, 0, 5, hsl(60, 60%, 70%), hsl(240, 40%, 70%));
    border-width: 1px;
}
*/

/* --- Compound Parent Node Styling --- */
/* Styles specifically for nodes that act as parents (containers) */
.parent-node {
    /* Inherits background/border color from depth styles unless overridden */
    shape: rectangle; /* Use rectangle shape for containers */
    border-width: 2px; /* Make parent border slightly thicker */
    border-style: dashed; /* Distinguish parent border */
    /* border-color: #888; */ /* Uncomment to set a specific parent border color */
    padding: 40px; /* Essential space for containing child nodes */

    /* Label styling for parent nodes */
    label: data(label); /* Display the node's name */
    text-valign: top;   /* Position label at the top */
    text-halign: center; /* Center label horizontally */
    text-margin-y: -15px; /* Move label slightly inside the top border */
    font-size: 12px;
    font-weight: bold; /* Make parent label stand out */
    color: #555555;    /* Label color */
}

/* --- Edge Styling --- */

/* Hide the direct edge between a child and its frontmatter-defined parent */
/* This avoids visual redundancy since nesting already shows the relationship */
edge.structural-parent-edge {
    display: none;
}

/* Default styling for other edges */
/* Uses edgeCount data if available (e.g., from Breadcrumbs plugin) */
edge[edgeCount] {
    width: mapData(edgeCount, 1, 15, 0.5, 3); /* Wider line for more links */
    line-opacity: mapData(edgeCount, 1, 15, 0.5, 0.9); /* More opaque for more links */
}

/* General edge appearance */
edge {
    /* Apply default styles if edgeCount is not present or to all edges */
    /* width: 1px; */ /* Uncomment for a fixed width */
    /* line-opacity: 0.6; */ /* Uncomment for fixed opacity */
    line-color: #ccc;
    target-arrow-shape: triangle;
    target-arrow-color: #ccc;
    curve-style: bezier; /* Or other styles like 'straight', 'haystack' */
}

/* Add other custom styles or tag styles below */
```