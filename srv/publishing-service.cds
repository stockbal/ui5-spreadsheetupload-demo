using {my.bookshop as db} from '../db/schema';

service PublishingService {
    @odata.draft.enabled
    entity Books as projection on db.Books;
}
