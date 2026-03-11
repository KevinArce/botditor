# Story 11: Thread Summarization

Status: ✅ Keep & Enrich

Feature area: AI Analysis

Story:
As a moderator, I want the app to generate an AI summary of a post's comment thread so that I can quickly understand the discussion and key points of contention without reading every comment.

Acceptance criteria:
- Summaries are generated on demand via a moderator menu action on posts (Story 12).
- The summary includes: overall sentiment, top 3–5 discussion points, any notable conflict or rule violations flagged, and a word count of the original thread.
- Input to Gemini is capped at the top 50 comments by score (or most recent 50 if scores are equal), with a max token budget of 10 000 input tokens.
- If the thread exceeds the token budget, the prompt notes how many comments were omitted.
- The summary is displayed in a Devvit form/toast or posted as a mod-distinguished comment (configurable).
- Failed summaries show a descriptive error message and do not post any content.

Feasibility rating: High

Justification:
Devvit supports reading all post comments via `post.comments.all()`. Gemini's `gemini-1.5-flash` handles long context well. `context.fetch()` enables the API call. No sandbox blockers.

Devvit hooks:
- `context.reddit.getPostById(postId)` then `post.comments.all()`
- `context.fetch()` to Gemini API (reuses Story 02 pipeline)
- `context.reddit.submitComment({ ...  })` if posting summary as a distinguished comment

Gemini prompt strategy:
```
You are a Reddit thread analyst helping a moderator. Summarize the following Reddit comment thread.

Post title: "{postTitle}"
Top {N} comments:
{commentTexts}

Return a structured summary with:
1. Overall thread sentiment (positive / neutral / negative / mixed)
2. Top 3–5 discussion points (bullet list)
3. Any signs of rule violations or significant conflict (bullet list, or "None detected")
4. Total comments analyzed: {N}
```

Edge cases:
- Post with 0 comments: return "No comments to summarize."
- Post with only deleted comments: skip deleted entries and note count in output.
- Very long individual comments: truncate each to 500 characters before concatenating.

Dependencies: Story 02 (Gemini pipeline reuse), Story 12 (the menu command that invokes this).
