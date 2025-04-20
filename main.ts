import {
    App,
    Editor,
    MarkdownView,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    normalizePath
} from 'obsidian';
// Import necessary Obsidian and Juggl APIs
import {IJugglPlugin, VizId, IJuggl, NodeDefinition} from 'juggl-api'; // Ensure NodeDefinition is imported if used, though it might not be directly needed here.

// This plugin modifies a Juggl graph to create compound nodes based on frontmatter links.
export default class CompoundNodePlugin extends Plugin {
    // Store a reference to the Juggl plugin API.
    private juggl?: IJugglPlugin;

    async onload() {
        // Ensure the Juggl plugin dependency is loaded and available before proceeding.
        await this.app.plugins.loadPlugin('juggl');
        this.juggl = this.app.plugins.getPlugin('juggl') as IJugglPlugin;

        // Check if Juggl was loaded successfully.
        if (!this.juggl) {
            console.error("Juggl plugin could not be loaded or found.");
            new Notice("Juggl plugin not found. Compound Node Plugin requires Juggl.");
            return;
        }
        console.log("Juggl Plugin loaded successfully by CompoundNodePlugin.");

        // Register callbacks for Juggl graph creation and destruction.
        this.juggl.registerEvents({
            onJugglCreated: (viz: IJuggl) => this.handleGraphCreated(viz),
            onJugglDestroyed: (viz: IJuggl) => { /* Optional cleanup */
            }
        });
        console.log("Juggl event handlers registered.");

        // Register an Obsidian event listener for file modifications.
        this.registerEvent(this.app.vault.on('modify', this.handleFileChange.bind(this)));
    }

    // Handles the creation of a new Juggl graph instance.
    private async handleGraphCreated(viz: IJuggl) {
        console.log("--- handleGraphCreated START ---");
        try {
            // Wait for the visualization to be ready.
            if (!viz.vizReady) {
                console.log("⏳ Waiting for vizReady...");
                // Simplified async wait; replace with your polling if needed
                await new Promise(resolve => setTimeout(resolve, 500)); // Basic wait, adjust timing or use robust polling
                if (!viz.vizReady) {
                    // Still not ready after basic wait, retry or use polling
                    await new Promise<void>((resolve, reject) => {
                        const maxWait = 10000;
                        const interval = 100;
                        let waited = 0;
                        const checker = setInterval(() => {
                            if (viz.vizReady) {
                                clearInterval(checker);
                                console.log("✅ vizReady confirmed via polling.");
                                resolve();
                            } else {
                                waited += interval;
                                if (waited >= maxWait) {
                                    clearInterval(checker);
                                    console.error("❌ Timed out waiting for vizReady.");
                                    reject(new Error("Timed out waiting for vizReady"));
                                }
                            }
                        }, interval);
                    });
                }
            } else {
                console.log("✅ viz already ready.");
            }

            // Process existing nodes for parent relationships.
            console.log("⚙️ Processing initial nodes for parent relationships...");
            const nodes = viz.viz.elements().nodes().toArray();
            console.log(`📊 Found ${nodes.length} initial nodes.`);

            // Process nodes sequentially.
            for (const node of nodes) {
                if (node && typeof node.id === 'function' && typeof node.data === 'function') {
                    try {
                        await this.processNode(node, viz);
                    } catch (e) {
                        console.error(`🔥 Error processing node ${node.id()}:`, e);
                    }
                } else {
                    console.warn("⚠️ Invalid node object encountered:", node);
                }
            }

            console.log("⚙️ Calculating node depths...");
            const allNodes = viz.viz.nodes();

            // Initialize depth for all nodes
            allNodes.data('depth', -1); // Mark as uncalculated

            // Recursive function to calculate depth
            const calculateDepth = (node: any, currentDepth: number) => {
                const existingDepth = node.data('depth');
                // Only update if not calculated or if found shallower path (though unlikely needed for strict parent hierarchy)
                if (existingDepth === -1 || currentDepth < existingDepth) {
                    node.data('depth', currentDepth);
                    // console.log(`[${node.id()}] Set depth: ${currentDepth}`); // Uncomment for debugging depth assignment

                    // Recurse for compound children
                    node.children().forEach((child: any) => {
                        calculateDepth(child, currentDepth + 1);
                    });
                }
            };

            // Start calculation from root nodes (nodes without a compound parent)
            const rootNodes = allNodes.filter((node: any) => node.parent().length === 0);
            // console.log(`🌳 Found ${rootNodes.length} root nodes.`); // Uncomment for debugging
            rootNodes.forEach((rootNode: any) => {
                calculateDepth(rootNode, 0); // Roots are at depth 0
            });

            // Handle any nodes missed (e.g., disconnected components, though less likely with this structure)
            const uncalculatedNodes = allNodes.filter((node: any) => node.data('depth') === -1);
            if (uncalculatedNodes.length > 0) {
                console.warn(`⚠️ Found ${uncalculatedNodes.length} nodes with uncalculated depth. Setting depth to 0.`);
                uncalculatedNodes.forEach((node: any) => node.data('depth', 0));
            }
            console.log("✅ Node depths calculated and set.");
            // ★★★★★★★★★★★★★★★★★★★★★★★★
            // ★★★ END: Calculate and set node depth ★★★
            // ★★★★★★★★★★★★★★★★★★★★★★★★

            // Restart layout after potentially moving nodes and setting depths.
            console.log("🔄 Performing final layout restart.");
            viz.restartLayout();

        } catch (error) {
            console.error("🔥 Uncaught error in handleGraphCreated:", error);
            new Notice("Error initializing compound nodes or calculating depth.");
        } finally {
            console.log("--- handleGraphCreated END ---");
        }
    }

    // Processes a single node for parenting and edge tagging.
    private async processNode(node: any, viz: IJuggl) {
        const nodeId = node.id();
        // console.log(`--- processNode START [${nodeId}] ---`); // Keep logs minimal or conditional

        const nodeData = node.data();
        const nodeFilePath = nodeData.path;

        if (!(nodeFilePath && nodeFilePath.endsWith('.md'))) {
            // console.log(`[${nodeId}] Skipping: Not a valid markdown file path.`);
            return; // Skip non-markdown nodes silently
        }

        const currentFile = this.app.vault.getAbstractFileByPath(nodeFilePath);
        if (!(currentFile instanceof TFile)) {
            // console.log(`[${nodeId}] Skipping: Could not get TFile for path ${nodeFilePath}.`);
            return; // Skip if file cannot be accessed
        }

        const fileCache = this.app.metadataCache.getFileCache(currentFile);
        const parentLinkText = fileCache?.frontmatter?.parent;

        if (!parentLinkText || typeof parentLinkText !== 'string' || !parentLinkText.startsWith('[[') || !parentLinkText.endsWith(']]')) {
            // console.log(`[${nodeId}] Skipping: No valid parent link found.`);
            return; // Skip if no valid parent link
        }

        const linkText = parentLinkText.replace(/[\[\]]/g, '');
        // console.log(`[${nodeId}] Extracted link text: '${linkText}'`);

        const parentFile: TFile | null = this.app.metadataCache.getFirstLinkpathDest(linkText, currentFile.path);
        // console.log(`[${nodeId}] Resolved parent link '${linkText}' to file:`, parentFile ? parentFile.path : 'null');

        let targetParentId: string;
        let parentCyNode: any | null = null;

        // Determine Parent Node in Cytoscape
        if (parentFile instanceof TFile) {
            targetParentId = VizId.fromFile(parentFile).toId();
            parentCyNode = viz.viz.$id(targetParentId);
            if (parentCyNode.length === 0) {
                console.warn(`[${nodeId}] ⚠️ Parent file node ${targetParentId} resolved BUT not found in graph! Skipping move.`);
                return;
            }
            // console.log(`[${nodeId}] Found existing Juggl node ${targetParentId} for parent file.`);
            if (!parentCyNode.hasClass('parent-node')) {
                parentCyNode.addClass('parent-node');
                // console.log(`[${nodeId}] ✨ Applied 'parent-node' class to existing node ${targetParentId}.`);
            }
        } else {
            targetParentId = linkText; // Use link text as placeholder ID
            parentCyNode = this.ensureMinimalParentNodeExists(targetParentId, viz);
            if (!parentCyNode) {
                console.error(`[${nodeId}] ❌ Failed to get/create placeholder parent node ${targetParentId}. Skipping move.`);
                return;
            }
            // console.log(`[${nodeId}] Got placeholder parent node ${parentCyNode.id()}.`);
        }

        // Tag the edge corresponding to the parent link before moving
        if (targetParentId && viz.viz) {
            const potentialParentEdges = viz.viz.edges(`edge[source = "${nodeId}"][target = "${targetParentId}"]`);
            if (potentialParentEdges.length > 0) {
                // console.log(`[${nodeId}] Tagging edge(s) to parent ${targetParentId} with 'structural-parent-edge'.`);
                potentialParentEdges.addClass('structural-parent-edge');
            }
        }

        // Move Node
        if (parentCyNode && parentCyNode.length > 0) {
            if (nodeId === targetParentId) {
                console.warn(`[${nodeId}] ⚠️ Attempting to move node into itself (${targetParentId}). Skipping.`);
                return;
            }
            // console.log(`[${nodeId}] >>> Attempting to move [${nodeId}] INTO parent [${targetParentId}] <<<`);
            try {
                viz.viz.batch(() => {
                    node.move({parent: targetParentId});
                });
                // const currentParent = node.data('parent');
                // console.log(`[${nodeId}] ✅ Node move successful. Current parent data: ${currentParent}`);
            } catch (moveError) {
                console.error(`[${nodeId}] 🔥 Move to parent ${targetParentId} FAILED:`, moveError);
            }
        } else {
            // console.error(`[${nodeId}] ❌ Cannot move: Parent node (${targetParentId}) invalid.`); // Should not happen if checks above pass
        }
        // console.log(`--- processNode END [${nodeId}] ---`);
    }


    // Ensures a minimal node exists for unresolved parent links. (No changes needed from previous version)
    private ensureMinimalParentNodeExists(parentId: string, viz: IJuggl): any | null {
        // console.log(`--- ensureMinimalParentNodeExists START [${parentId}] ---`);
        if (!viz?.viz) {
            console.error(`[${parentId}] ⚠️ Core Cytoscape instance missing!`);
            return null;
        }

        const existingNodes = viz.viz.$id(parentId);
        if (existingNodes.length > 0) {
            // console.log(`[${parentId}] ✅ Minimal placeholder node already exists.`);
            const existingNode = existingNodes[0];
            if (!existingNode.hasClass('parent-node')) {
                existingNode.addClass('parent-node');
                // console.log(`[${parentId}] ✨ Applied class 'parent-node' to existing placeholder.`);
            }
            return existingNode;
        }

        // console.log(`[${parentId}] ℹ️ Minimal placeholder node does not exist. Attempting add...`);
        try {
            const minimalDef = {group: 'nodes' as const, data: {id: parentId}};
            const addedCollection = viz.viz.add(minimalDef);
            const addedNode = addedCollection.length > 0 ? addedCollection[0] : null;

            if (!addedNode) {
                console.error(`[${parentId}] ❌ viz.viz.add failed to return a node.`);
                return null;
            }
            // console.log(`[${parentId}] ✨ Minimal placeholder node added successfully.`);

            try {
                addedNode.data({label: parentId}); // Set label only for placeholder
                // console.log(`[${parentId}] ✨ Applied data (label) to new placeholder.`);
            } catch (dataError) {
                console.error(`[${parentId}] 🔥 Failed to apply data to new placeholder:`, dataError);
                addedNode.remove();
                return null;
            }

            addedNode.addClass('parent-node');
            // console.log(`[${parentId}] ✨ Applied class 'parent-node' to new placeholder.`);
            // console.log(`--- ensureMinimalParentNodeExists END [${parentId}] ---`);
            return addedNode;

        } catch (e: any) {
            console.error(`[${parentId}] 🔥 MINIMAL placeholder add FAILED:`, {message: e.message});
            // console.log(`--- ensureMinimalParentNodeExists END [${parentId}] ---`);
            return null;
        }
    }


    // Handles file changes. (No changes needed from previous version)
    private async handleFileChange(file: TFile) {
        console.log(`File changed: ${file.path}. Refreshing relevant graphs.`);
        const vizId = VizId.fromFile(file);
        // Trigger refresh on relevant graphs; Consider full graph re-process if frontmatter changed significantly
        this.juggl?.activeGraphs().forEach(viz => {
            if (viz.vizReady) {
                const node = viz.viz.$id(vizId.toId());
                if (node.length > 0) {
                    console.log(`Refreshing node for ${file.path} in active graph.`);
                    // Refresh the node data. Consider if full re-processing of this node is needed.
                    viz.refreshNode(vizId, viz);
                    // TODO: Re-run depth calculation or relevant parts if structure changed.
                    // For simplicity, might require full graph refresh on parent change.
                }
            }
        });
    }

    // Plugin unload cleanup.
    onunload() {
        console.log("Unloading CompoundNodePlugin");
        // Juggl might handle unregistering automatically. Add specific cleanup if needed.
    }
}
