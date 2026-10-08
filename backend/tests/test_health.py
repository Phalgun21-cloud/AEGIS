def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_db(client):
    r = client.get("/health/db")
    assert r.status_code == 200
    assert r.json()["database"] == "up"


def test_roles_are_the_four_mvp_roles():
    from app.models import Role

    assert {r.value for r in Role} == {"admin", "author", "reviewer", "candidate"}
