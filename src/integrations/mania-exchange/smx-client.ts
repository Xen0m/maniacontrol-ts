const SMX_BASE_URL = "https://sm.mania.exchange";
const DEFAULT_USER_AGENT = "maniacontrol-ts/0.1.0 (+https://github.com/Xen0m/maniacontrol-ts)";

export interface SmxMapSummary {
  mapId: number;
  mapUid?: string;
  name?: string;
  gbxMapName?: string;
  authorNames: string[];
  author?: string;
  downloadUrl: string;
}

export interface SmxSearchOptions {
  name?: string;
  author?: string;
  limit?: number;
}

interface SmxSearchResponse {
  More?: boolean;
  Results?: SmxSearchResult[];
}

interface SmxSearchResult {
  MapId?: number;
  MapUid?: string;
  Name?: string;
  GbxMapName?: string;
  Authors?: Array<{
    User?: {
      Name?: string;
    };
  }>;
}

export class SmxClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;

  public constructor(baseUrl = SMX_BASE_URL, userAgent = DEFAULT_USER_AGENT) {
    this.baseUrl = baseUrl;
    this.userAgent = userAgent;
  }

  public async searchMaps(options: SmxSearchOptions): Promise<SmxMapSummary[]> {
    const limit = options.limit ?? 10;
    const params = new URLSearchParams();
    params.set(
      "fields",
      "MapId,MapUid,Name,GbxMapName,Authors[].User.Name"
    );
    params.set("perpage", String(limit));

    if (options.name) {
      params.set("name", options.name);
    }
    if (options.author) {
      params.set("author", options.author);
    }

    const response = await fetch(`${this.baseUrl}/api/maps?${params.toString()}`, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`SMX search failed with status ${response.status}`);
    }

    const payload = (await response.json()) as SmxSearchResponse;
    const results = payload.Results ?? [];

    return mapSearchResults(results, this.baseUrl).slice(0, limit);
  }

  public async getMapById(mapId: number): Promise<SmxMapSummary | null> {
    const params = new URLSearchParams();
    params.set("fields", "MapId,MapUid,Name,GbxMapName,Authors[].User.Name");
    params.set("id", String(mapId));
    params.set("perpage", "1");

    const response = await fetch(`${this.baseUrl}/api/maps?${params.toString()}`, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`SMX map lookup failed with status ${response.status}`);
    }

    const payload = (await response.json()) as SmxSearchResponse;
    const [result] = mapSearchResults(payload.Results ?? [], this.baseUrl);
    return result ?? null;
  }

  public async downloadMap(mapId: number): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/maps/download/${mapId}`, {
      headers: {
        "User-Agent": this.userAgent
      },
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`SMX download failed with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

function mapSearchResults(results: SmxSearchResult[], baseUrl: string): SmxMapSummary[] {
  return results
    .filter((result): result is SmxSearchResult & { MapId: number } => {
      return typeof result.MapId === "number";
    })
    .map((result) => {
      const authorNames = (result.Authors ?? [])
        .map((author) => author.User?.Name)
        .filter((name): name is string => typeof name === "string" && name.length > 0);

      return {
        mapId: result.MapId,
        mapUid: result.MapUid,
        name: result.Name,
        gbxMapName: result.GbxMapName,
        authorNames,
        author: authorNames[0],
        downloadUrl: `${baseUrl}/maps/download/${result.MapId}`
      } satisfies SmxMapSummary;
    });
}
