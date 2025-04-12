import { AccountSettingsNavbar } from "@/app/(app)/environments/[environmentId]/settings/(account)/components/AccountSettingsNavbar";
import { SettingsCard } from "@/app/(app)/environments/[environmentId]/settings/components/SettingsCard";
import { authOptions } from "@/modules/auth/lib/authOptions";
import { PageContentWrapper } from "@/modules/ui/components/page-content-wrapper";
import { PageHeader } from "@/modules/ui/components/page-header";
import { getTranslate } from "@/tolgee/server";
import { getServerSession } from "next-auth";
import { prisma } from "@formbricks/database";
import { getUser } from "@formbricks/lib/user/service";
import type { TUserNotificationSettings } from "@formbricks/types/user";
import { EditAlerts } from "./components/EditAlerts";
import { EditWeeklySummary } from "./components/EditWeeklySummary";
import { IntegrationsTip } from "./components/IntegrationsTip";
import type { Membership } from "./types";

const setCompleteNotificationSettings = (
  notificationSettings: TUserNotificationSettings,
  memberships: Membership[]
): TUserNotificationSettings => {
  const newNotificationSettings = {
    alert: {},
    weeklySummary: {},
    unsubscribedOrganizationIds: notificationSettings.unsubscribedOrganizationIds || [],
  };
  for (const membership of memberships) {
    for (const project of membership.organization.projects) {
      // set default values for weekly summary
      newNotificationSettings.weeklySummary[project.id] =
        notificationSettings.weeklySummary?.[project.id] || false;
      // set default values for alerts
      for (const environment of project.environments) {
        for (const survey of environment.surveys) {
          newNotificationSettings.alert[survey.id] =
            notificationSettings[survey.id]?.responseFinished ||
            notificationSettings.alert?.[survey.id] ||
            false; // check for legacy notification settings w/o "alerts" key
        }
      }
    }
  }
  return newNotificationSettings;
};

const getMemberships = async (userId: string): Promise<Membership[]> => {
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      role: {
        not: "billing",
      },
      OR: [
        {
          // Fetch all projects if user role is owner or manager
          role: {
            in: ["owner", "manager"],
          },
        },
        {
          // Filter projects based on team membership if user is not owner or manager
          organization: {
            projects: {
              some: {
                projectTeams: {
                  some: {
                    team: {
                      teamUsers: {
                        some: {
                          userId,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: {
      organization: {
        select: {
          id: true,
          name: true,
          projects: {
            // Apply conditional filtering based on user's role
            where: {
              OR: [
                {
                  // Fetch all projects if user is owner or manager
                  organization: {
                    memberships: {
                      some: {
                        userId,
                        role: {
                          in: ["owner", "manager"],
                        },
                      },
                    },
                  },
                },
                {
                  // Only include projects accessible through teams if user is not owner or manager
                  projectTeams: {
                    some: {
                      team: {
                        teamUsers: {
                          some: {
                            userId,
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              name: true,
              environments: {
                where: {
                  type: "production",
                },
                select: {
                  id: true,
                  surveys: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return memberships;
};

const Page = async (props) => {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const t = await getTranslate();
  const session = await getServerSession(authOptions);
  if (!session) {
    throw new Error(t("common.session_not_found"));
  }
  const autoDisableNotificationType = searchParams.type;
  const autoDisableNotificationElementId = searchParams.elementId;

  // Fetch user first
  const user = await getUser(session.user.id);
  if (!user) {
    throw new Error(t("common.user_not_found"));
  }

  let memberships: Membership[] = []; // Initialize memberships as an empty array

  // Conditionally fetch memberships only if DATABASE_URL is likely present (runtime)
  if (process.env.DATABASE_URL) {
    try {
      const fetchedMemberships = await getMemberships(session.user.id);
      if (fetchedMemberships) {
        memberships = fetchedMemberships;
      } else {
        // Optional: Log if getMemberships unexpectedly returned null/undefined at runtime
        console.warn("getMemberships returned null/undefined at runtime.");
      }
    } catch (error) {
      console.error("Database error fetching memberships at runtime:", error);
      // Keep memberships as [] to avoid crashing, but log the runtime error
    }
  } else {
    // Likely build phase or DATABASE_URL is missing
    console.log("Skipping membership fetch during build/without DATABASE_URL.");
  }

  // Initialize notification settings based on user data, if available
  // Create a mutable copy or ensure the original object structure matches expected defaults
  let finalNotificationSettings = user.notificationSettings
    ? { ...user.notificationSettings }
    : { alert: {}, weeklySummary: {}, unsubscribedOrganizationIds: [] };

  // Only attempt to complete settings if memberships were actually fetched
  if (memberships.length > 0) {
    finalNotificationSettings = setCompleteNotificationSettings(finalNotificationSettings, memberships);
  }
  // Assign potentially modified settings back to user object for passing down
  // Ensure this mutation is safe or handle immutably if necessary elsewhere
  user.notificationSettings = finalNotificationSettings;

  return (
    <PageContentWrapper>
      <PageHeader pageTitle={t("common.account_settings")}>
        <AccountSettingsNavbar environmentId={params.environmentId} activeId="notifications" />
      </PageHeader>
      <SettingsCard
        title={t("environments.settings.notifications.email_alerts_surveys")}
        description={t(
          "environments.settings.notifications.set_up_an_alert_to_get_an_email_on_new_responses"
        )}>
        {/* Pass potentially empty memberships array */}
        <EditAlerts
          memberships={memberships}
          user={user}
          environmentId={params.environmentId}
          autoDisableNotificationType={autoDisableNotificationType}
          autoDisableNotificationElementId={autoDisableNotificationElementId}
        />
      </SettingsCard>
      <IntegrationsTip environmentId={params.environmentId} />
      <SettingsCard
        title={t("environments.settings.notifications.weekly_summary_projects")}
        description={t("environments.settings.notifications.stay_up_to_date_with_a_Weekly_every_Monday")}>
        {/* Pass potentially empty memberships array */}
        <EditWeeklySummary memberships={memberships} user={user} environmentId={params.environmentId} />
      </SettingsCard>
    </PageContentWrapper>
  );
};

export default Page;
