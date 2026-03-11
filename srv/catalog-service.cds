using {my.bookshop as db} from '../db/schema';

service CatalogService {
    @odata.draft.enabled
    entity Books as projection on db.Books;
}
