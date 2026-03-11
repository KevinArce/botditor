import { Devvit, type FormField } from "@devvit/public-api";

import { handleNuke, handleNukePost } from "./nuke.js";
import { handleCommentSubmit } from "./commentIngestion.js";
import {
  addUserToAllowlist,
  removeUserFromAllowlist,
  isUserAllowlisted,
} from "./allowlist.js";

// Register all app settings (must be imported before Devvit.configure)
import "./settings.js";

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// ---------------------------------------------------------------------------
// Story 01 – Comment Ingestion Trigger
// ---------------------------------------------------------------------------

Devvit.addTrigger({
  event: "CommentSubmit",
  onEvent: async (event, context) => {
    try {
      await handleCommentSubmit(event, context);
    } catch (err) {
      // Top-level safety net: never let one comment crash the trigger for others
      console.error(
        `[trigger] Unhandled error in CommentSubmit handler:`,
        err
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Story 23 (partial) – Allowlist Menu Actions
// ---------------------------------------------------------------------------

Devvit.addMenuItem({
  label: "Add author to allowlist",
  description: "Allow-list this comment's author so their comments skip analysis.",
  location: "comment",
  forUserType: "moderator",
  onPress: async (event, context) => {
    if (!event.targetId) {
      context.ui.showToast("Could not determine comment.");
      return;
    }
    try {
      const comment = await context.reddit.getCommentById(event.targetId);
      const author = comment.authorName;
      await addUserToAllowlist(author, context.redis);
      context.ui.showToast(`u/${author} added to allowlist.`);
    } catch (err) {
      console.error("[allowlist] Failed to add user:", err);
      context.ui.showToast("Failed to add user to allowlist.");
    }
  },
});

Devvit.addMenuItem({
  label: "Remove author from allowlist",
  description: "Remove this comment's author from the allowlist.",
  location: "comment",
  forUserType: "moderator",
  onPress: async (event, context) => {
    if (!event.targetId) {
      context.ui.showToast("Could not determine comment.");
      return;
    }
    try {
      const comment = await context.reddit.getCommentById(event.targetId);
      const author = comment.authorName;
      await removeUserFromAllowlist(author, context.redis);
      context.ui.showToast(`u/${author} removed from allowlist.`);
    } catch (err) {
      console.error("[allowlist] Failed to remove user:", err);
      context.ui.showToast("Failed to remove user from allowlist.");
    }
  },
});

const nukeFields: FormField[] = [
  {
    name: "remove",
    label: "Remove comments",
    type: "boolean",
    defaultValue: true,
  },
  {
    name: "lock",
    label: "Lock comments",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "skipDistinguished",
    label: "Skip distinguished comments",
    type: "boolean",
    defaultValue: false,
  },
] as const;

const nukeForm = Devvit.createForm(
  () => {
    return {
      fields: nukeFields,
      title: "Mop Comments",
      acceptLabel: "Mop",
      cancelLabel: "Cancel",
    };
  },
  async ({ values }, context) => {
    if (!values.lock && !values.remove) {
      context.ui.showToast("You must select either lock or remove.");
      return;
    }

    if (context.commentId) {
      const result = await handleNuke(
        {
          remove: values.remove,
          lock: values.lock,
          skipDistinguished: values.skipDistinguished,
          commentId: context.commentId,
          subredditId: context.subredditId,
        },
        context
      );
      console.log(
        `Mop result - ${result.success ? "success" : "fail"} - ${
          result.message
        }`
      );
      context.ui.showToast(
        `${result.success ? "Success" : "Failed"} : ${result.message}`
      );
    } else {
      context.ui.showToast(`Mop failed! Please try again later.`);
    }
  }
);

Devvit.addMenuItem({
  label: "Mop comments",
  description:
    "Remove this comment and all child comments. This might take a few seconds to run.",
  location: "comment",
  forUserType: "moderator",
  onPress: (_, context) => {
    context.ui.showForm(nukeForm);
  },
});

const nukePostForm = Devvit.createForm(
  () => {
    return {
      fields: nukeFields,
      title: "Mop Post Comments",
      acceptLabel: "Mop",
      cancelLabel: "Cancel",
    };
  },
  async ({ values }, context) => {
    if (!values.lock && !values.remove) {
      context.ui.showToast("You must select either lock or remove.");
      return;
    }

    if (!context.postId) {
      throw new Error("No post ID");
    }

    const result = await handleNukePost(
      {
        remove: values.remove,
        lock: values.lock,
        skipDistinguished: values.skipDistinguished,
        postId: context.postId,
        subredditId: context.subredditId,
      },
      context
    );
    console.log(
      `Mop result - ${result.success ? "success" : "fail"} - ${result.message}`
    );
    context.ui.showToast(
      `${result.success ? "Success" : "Failed"} : ${result.message}`
    );
  }
);

Devvit.addMenuItem({
  label: "Mop post comments",
  description:
    "Remove all comments of this post. This might take a few seconds to run.",
  location: "post",
  forUserType: "moderator",
  onPress: (_, context) => {
    context.ui.showForm(nukePostForm);
  },
});

export default Devvit;
