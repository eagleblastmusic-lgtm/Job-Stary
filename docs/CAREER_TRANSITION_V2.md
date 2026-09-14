# Career Transition Engine — V2

Career Transition uses a deliberately small, curated graph of adjacent occupations. The graph is a navigation aid, not a complete occupational taxonomy and not a claim that a transition is easy or advisable.

For each adjacent role the engine compares only evidence already available to the product:

- confirmed Career Truth / credentials / user skills;
- `MUST_HAVE` requirements from the user's saved target-role jobs;
- number of matching saved jobs;
- matching official local-labour snapshots and their source count;
- available observed monthly salary ranges.

Requirements not found in confirmed Career Truth are labelled **not confirmed**, not absent. Transition difficulty is derived only when saved target requirements exist; otherwise it remains unknown. Small job/local samples use the same confidence vocabulary as Bottleneck and Skill ROI.

The application records only the user's explicit exploration of a path. It does not silently rewrite desired roles, Career Truth, CVs or applications.

The feature remains disabled by default behind `career_transition` and can be rolled out/rolled back through the shared feature-flag mechanism.
