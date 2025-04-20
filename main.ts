import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';
// Import necessary Obsidian and Juggl APIs
import { IJugglPlugin, VizId, IJuggl, NodeDefinition } from 'juggl-api';

// This plugin modifies a Juggl graph to create compound nodes based on frontmatter links.
export default class CompoundNodePlugin extends Plugin {
	// Store a reference to the Juggl plugin API.
	private juggl?: IJugglPlugin;

	async onload() {
		// Ensure the Juggl plugin dependency is loaded and available before proceeding.
		// This might be necessary if load order isn't guaranteed.
		await this.app.plugins.loadPlugin('juggl');
		this.juggl = this.app.plugins.getPlugin('juggl') as IJugglPlugin;

		// Check if Juggl was loaded successfully. This plugin cannot function without it.
		if (!this.juggl) {
			console.error("Juggl plugin could not be loaded or found.");
			new Notice("Juggl plugin not found. Compound Node Plugin requires Juggl.");
			return; // Stop loading if Juggl isn't present.
		}
		console.log("Juggl Plugin loaded successfully by CompoundNodePlugin.");

		// Register callbacks for Juggl graph creation and destruction.
		this.juggl.registerEvents({
			// Called whenever a new Juggl graph visualization is created.
			onJugglCreated: (viz: IJuggl) => this.handleGraphCreated(viz),
			// Called when a Juggl graph visualization is destroyed (optional cleanup).
			onJugglDestroyed: (viz: IJuggl) => { /* Cleanup if needed */ }
		});
		console.log("Juggl event handlers registered.");

		// Register an Obsidian event listener to detect file modifications.
		// This might be used to update the graph when related files change.
		this.registerEvent(this.app.vault.on('modify', this.handleFileChange.bind(this)));
	}

	// Handles the creation of a new Juggl graph instance.
	private async handleGraphCreated(viz: IJuggl) {
		console.log("--- handleGraphCreated START ---");
		try {
			// Juggl graphs might take a moment to become fully ready after creation.
			// We need to wait for `vizReady` before interacting with the Cytoscape instance.
			if (!viz.vizReady) {
				console.log("⏳ Waiting for vizReady...");
				// Poll until the visualization is ready, with a timeout.
				await new Promise<void>((resolve, reject) => {
					const maxWait = 10000; // Max 10 seconds wait
					const interval = 100; // Check every 100ms
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
			} else {
				console.log("✅ viz already ready.");
			}

			// Process all existing nodes in the graph to establish initial parent relationships.
			console.log("⚙️ Processing initial nodes for parent relationships...");
			const nodes = viz.viz.elements().nodes().toArray();
			console.log(`📊 Found ${nodes.length} initial nodes.`);

			// Process nodes one by one to avoid potential race conditions or complex state management.
			for (const node of nodes) {
				// Basic sanity check to ensure the node object is valid before processing.
				if (node && typeof node.id === 'function' && typeof node.data === 'function') {
					try {
						// Process each node to check for a 'parent' link and move it if found.
						await this.processNode(node, viz);
					} catch (e) {
						// Log errors during individual node processing but continue with others.
						console.error(`🔥 Error processing node ${node.id()}:`, e);
					}
				} else {
					console.warn("⚠️ Invalid node object encountered during iteration:", node);
				}
			}

			// After potentially moving nodes into parents, restart the layout
			// to make the compound node structure visually apparent.
			console.log("🔄 Performing final layout restart.");
			viz.restartLayout();

		} catch (error) {
			// Catch any unexpected errors during the graph handling process.
			console.error("🔥 Uncaught error in handleGraphCreated:", error);
			new Notice("Error initializing compound nodes.");
		} finally {
			console.log("--- handleGraphCreated END ---");
		}
	}

	// Processes a single node to determine if it should be moved under a parent node.
	private async processNode(node: any, viz: IJuggl) {
		const nodeId = node.id(); // The unique ID of the node in the Cytoscape graph.
		console.log(`--- processNode START [${nodeId}] ---`);

		const nodeData = node.data();
		const nodeFilePath = nodeData.path; // The Obsidian vault path associated with this node.

		console.log(`[${nodeId}] Path: ${nodeFilePath}`);

		// We only care about actual markdown files that have a path.
		if (!(nodeFilePath && nodeFilePath.endsWith('.md'))) {
			console.log(`[${nodeId}] Skipping: Not a valid markdown file path.`);
			console.log(`--- processNode END [${nodeId}] ---`);
			return;
		}

		// Get the TFile object to access metadata and resolve relative links correctly.
		const currentFile = this.app.vault.getAbstractFileByPath(nodeFilePath);
		if (!(currentFile instanceof TFile)) {
			console.log(`[${nodeId}] Skipping: Could not get TFile for path ${nodeFilePath}.`);
			console.log(`--- processNode END [${nodeId}] ---`);
			return;
		}

		// Read the 'parent' property from the file's frontmatter.
		let parentLinkText: string | undefined = undefined;
		const fileCache = this.app.metadataCache.getFileCache(currentFile);
		// Access frontmatter using optional chaining for safety.
		parentLinkText = fileCache?.frontmatter?.parent;
		console.log(`[${nodeId}] Frontmatter check: parent = ${parentLinkText}`);

		// Check if the parent link exists and is in the expected [[wikilink]] format.
		if (!parentLinkText || typeof parentLinkText !== 'string' || !parentLinkText.startsWith('[[') || !parentLinkText.endsWith(']]')) {
			console.log(`[${nodeId}] Skipping: No valid parent link found (expected '[[...]]'). Value:`, parentLinkText);
			console.log(`--- processNode END [${nodeId}] ---`);
			return;
		}

		// Extract the actual link text (e.g., 'My Parent Note') from the [[wikilink]].
		const linkText = parentLinkText.replace(/[\[\]]/g, '');
		console.log(`[${nodeId}] Extracted link text: '${linkText}'`);

		// Use Obsidian's API to resolve the wikilink relative to the current file's path.
		// This finds the TFile the link points to, if it exists.
		const parentFile: TFile | null = this.app.metadataCache.getFirstLinkpathDest(linkText, currentFile.path);
		console.log(`[${nodeId}] Resolved parent link '${linkText}' to file:`, parentFile ? parentFile.path : 'null');

		let targetParentId: string; // The ID of the target parent node in the Cytoscape graph.
		let parentCyNode: any | null = null; // The Cytoscape node object for the parent.

		// --- Determine Parent Node in Cytoscape ---
		if (parentFile instanceof TFile) {
			// Case 1: The parent link successfully resolved to an existing file.
			console.log(`[${nodeId}] ✅ Parent file resolved: ${parentFile.path}. Using its Juggl node.`);
			// Generate the Juggl/Cytoscape ID for the resolved parent file.
			targetParentId = VizId.fromFile(parentFile).toId();
			console.log(`[${nodeId}] Target Parent ID (from resolved file): ${targetParentId}`);
			// Find this parent node within the current Cytoscape graph instance.
			parentCyNode = viz.viz.$id(targetParentId);

			if (parentCyNode.length === 0) {
				// This is unexpected if Juggl processed the file, but could happen.
				console.warn(`[${nodeId}] ⚠️ Parent file node ${targetParentId} resolved BUT not found in the current graph!? Skipping move.`);
				console.log(`--- processNode END [${nodeId}] ---`);
				return;
			}
			console.log(`[${nodeId}] Found existing Juggl node ${targetParentId} for parent file.`);
			// Ensure the existing file node is marked as a parent for styling or identification.
			if (!parentCyNode.hasClass('parent-node')) {
				parentCyNode.addClass('parent-node');
				console.log(`[${nodeId}] ✨ Applied 'parent-node' class to existing node ${targetParentId}.`);
			}
		} else {
			// Case 2: The parent link did not resolve to any known file. Create/use a placeholder.
			console.log(`[${nodeId}] ❌ Parent link '${linkText}' did not resolve to a file. Using placeholder.`);
			// Use the raw link text as the ID for the placeholder parent node.
			targetParentId = linkText;
			console.log(`[${nodeId}] Target Parent ID (placeholder): ${targetParentId}`);
			// Ensure a minimal node exists in the graph for this ID.
			parentCyNode = this.ensureMinimalParentNodeExists(targetParentId, viz);

			if (!parentCyNode) {
				// If we couldn't get or create the placeholder, we can't proceed.
				console.error(`[${nodeId}] ❌ Failed to get or create placeholder parent node ${targetParentId}. Skipping move.`);
				console.log(`--- processNode END [${nodeId}] ---`);
				return;
			}
			console.log(`[${nodeId}] Got placeholder parent node ${parentCyNode.id()}.`);
		}

		// --- Move Node ---
		// Ensure we have a valid parent node object before attempting the move.
		if (parentCyNode && parentCyNode.length > 0) {
			// Prevent a node from being moved into itself.
			if (nodeId === targetParentId) {
				console.warn(`[${nodeId}] ⚠️ Attempting to move node into itself (${targetParentId}). Skipping.`);
				console.log(`--- processNode END [${nodeId}] ---`);
				return;
			}
			console.log(`[${nodeId}] >>> Attempting to move [${nodeId}] INTO parent [${targetParentId}] <<<`);
			try {
				// Use Cytoscape's batch operation for potential performance benefits or atomicity.
				viz.viz.batch(() => {
					// Execute the move operation: make the current node a child of the target parent.
					node.move({ parent: targetParentId });
				});
				// Verify the move by checking the node's 'parent' data attribute.
				const currentParent = node.data('parent');
				console.log(`[${nodeId}] ✅ Node move successful. Current parent data: ${currentParent}`);
				// Sanity check if the reported parent matches the intended target.
				if (currentParent !== targetParentId) {
					console.warn(`[${nodeId}] ⚠️ Post-move parent data (${currentParent}) doesn't match target (${targetParentId})?`);
				}
			} catch (moveError) {
				// Catch errors specifically related to the move operation.
				console.error(`[${nodeId}] 🔥 Move to parent ${targetParentId} FAILED:`, moveError);
			}
		} else {
			// If, after all checks, the parentCyNode is invalid, log an error.
			console.error(`[${nodeId}] ❌ Cannot move: Final parent node (${targetParentId}) is invalid or not found after checks.`);
		}

		console.log(`--- processNode END [${nodeId}] ---`);
	}

	// Ensures a minimal node exists in the graph for a given ID (used for unresolved parent links).
	// If it exists, return it. If not, create it with minimal data and return it.
	private ensureMinimalParentNodeExists(parentId: string, viz: IJuggl): any | null {
		console.log(`--- ensureMinimalParentNodeExists START [${parentId}] ---`);
		// Cannot operate if the core Cytoscape instance isn't available.
		if (!viz?.viz) {
			console.error(`[${parentId}] ⚠️ Core Cytoscape instance missing!`);
			return null;
		}

		// Check if a node with this ID already exists in the graph.
		const existingNodes = viz.viz.$id(parentId);
		if (existingNodes.length > 0) {
			console.log(`[${parentId}] ✅ Minimal placeholder node already exists.`);
			const existingNode = existingNodes[0];
			// Ensure the existing placeholder also gets the parent class.
			if (!existingNode.hasClass('parent-node')) {
				existingNode.addClass('parent-node');
				console.log(`[${parentId}] ✨ Applied class 'parent-node' to existing placeholder.`);
			}
			// Avoid adding extra data to an existing node if it's just a placeholder check.
			return existingNode;
		}

		// If the node doesn't exist, create a new one.
		console.log(`[${parentId}] ℹ️ Minimal placeholder node does not exist. Attempting add...`);
		try {
			// Define the absolute minimum data required to add a node to Cytoscape.
			const minimalDef = { group: 'nodes' as const, data: { id: parentId } };
			// Add the node to the graph.
			const addedCollection = viz.viz.add(minimalDef);
			const addedNode = addedCollection.length > 0 ? addedCollection[0] : null;

			// Check if the add operation actually returned a node.
			if (!addedNode) {
				console.error(`[${parentId}] ❌ viz.viz.add failed to return a node.`);
				return null;
			}
			console.log(`[${parentId}] ✨ Minimal placeholder node added successfully.`);

			try {
				// Set the label for the placeholder node, typically using its ID (the link text).
				// Avoid setting 'path' or 'type' as they are irrelevant for placeholders.
				addedNode.data({ label: parentId });
				console.log(`[${parentId}] ✨ Applied data (label) to new placeholder.`);
			} catch (dataError) {
				// If setting data fails, remove the partially created node to avoid issues.
				console.error(`[${parentId}] 🔥 Failed to apply data to new placeholder:`, dataError);
				addedNode.remove(); // Clean up the failed node addition.
				return null;
			}

			// Mark the new placeholder as a parent node.
			addedNode.addClass('parent-node');
			console.log(`[${parentId}] ✨ Applied class 'parent-node' to new placeholder.`);
			return addedNode; // Return the newly created and configured node.

		} catch (e: any) { // Catch any errors during node addition.
			console.error(`[${parentId}] 🔥 MINIMAL placeholder add FAILED:`, { message: e.message });
			return null; // Return null on failure.
		} finally {
			console.log(`--- ensureMinimalParentNodeExists END [${parentId}] ---`);
		}
	}

	// Handles file modification events detected by Obsidian.
	private async handleFileChange(file: TFile) {
		// TODO: Review and potentially refine the refresh logic.
		// A simple node refresh might be sufficient, or full reprocessing might be needed
		// depending on what changed (e.g., frontmatter vs content).
		console.log(`File changed: ${file.path}. Refresh logic needs review.`);
		// Generate the Juggl ID for the modified file.
		const vizId = VizId.fromFile(file);
		// Iterate through all currently active Juggl graphs.
		this.juggl?.activeGraphs().forEach(viz => {
			// Only interact with graphs that are ready.
			if (viz.vizReady) {
				console.log(`Refreshing node for ${file.path} in active graph.`);
				// Trigger a refresh of the specific node in the graph.
				// `refreshNode` might update data and potentially re-run layout logic.
				// Consider if `processNode` needs to be called again instead/additionally.
				viz.refreshNode(vizId, viz);
			}
		});
	}

	// Called when the plugin is disabled or Obsidian is closing.
	onunload() {
		// Perform any cleanup here, e.g., unregistering event handlers if necessary.
		console.log("Unloading CompoundNodePlugin");
		// Note: Juggl event handlers might be automatically unregistered by Juggl itself.
	}
}
