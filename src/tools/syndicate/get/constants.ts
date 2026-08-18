export const GET_SYNDICATE_DESCRIPTION = [
    'Open one syndicate by id — its trusted card (manager, the four fee rates as percentages, member count,',
    'creation time) plus a page of its members. Members are returned in the registry order (joinedAt ascending,',
    'then address); page them with membersLimit/membersOffset. An unknown id is an error; a members page past',
    'the end is empty. Player-authored name/link are intentionally excluded; request them explicitly with',
    'cpu_get_syndicate_player_content. Public read.',
].join(' ');
