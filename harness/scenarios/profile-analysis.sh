# profile-analysis (S, `profile-analysis` script, LANDED=1): the built-in analysis profile: scout -> analyst -> verify (a check writing JUnit to $CADRE_JUNIT; one failing case sends the task back once) -> examiner -> landing;
# no tester, no worker, no reviewer, no changelog. The oracle reads the briefs for the profile's own words only (oracle: profile-analysis)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "analyse the sample data and write analysis/summary.md with the finding and its conclusion"; until_plan
