CREATE TABLE IF NOT EXISTS markers (
                                       id SERIAL PRIMARY KEY,
                                       username TEXT NOT NULL,
                                       coords DOUBLE PRECISION[] NOT NULL, -- [lon, lat]
                                       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS polylines (
                                         id SERIAL PRIMARY KEY,
                                         username TEXT NOT NULL,
                                         coords DOUBLE PRECISION[][] NOT NULL, -- array of [lon, lat]
                                         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Optional seed data
INSERT INTO markers (username, coords) VALUES
                                           ('alice', ARRAY[-72.575, 44.260]),
                                           ('bob',   ARRAY[-72.580, 44.265])
    ON CONFLICT DO NOTHING;

INSERT INTO polylines (username, coords) VALUES
                                             ('alice', ARRAY[
                                                 ARRAY[-72.58, 44.26],
                                              ARRAY[-72.579, 44.261],
                                              ARRAY[-72.578, 44.262]
    ]),
                                             ('bob', ARRAY[
                                                 ARRAY[-72.581, 44.264],
                                              ARRAY[-72.582, 44.265],
                                              ARRAY[-72.583, 44.266]
    ]);
